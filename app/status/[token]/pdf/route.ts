// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { appBaseUrl } from "@/lib/public-api";
import { buildConfirmationPdf } from "@/lib/pdf";
import { resolveApplicationCardId } from "@/lib/public-status";
import { dbErrorWithoutParams } from "@/lib/db-errors";
import { allowFormRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // PDF-Erzeugung kostet CPU — als einziger öffentlicher Einstieg war diese
  // Route bisher ungebremst (Formular, Uploads und API haben alle ein Limit).
  if (!(await allowFormRequest("status-pdf"))) {
    return new Response("Zu viele Anfragen. Bitte später erneut versuchen.", {
      status: 429,
    });
  }
  const { token } = await params;
  let antrag: typeof cards.$inferSelect | undefined;
  try {
    [antrag] = await db
      .select()
      .from(cards)
      .where(eq(cards.token, token))
      .limit(1);
  } catch (e) {
    // Kein Durchreichen: Drizzle-Fehlertexte enthalten die Query-Parameter —
    // hier also den geheimen Status-Token, der nie in Logs landen darf.
    throw dbErrorWithoutParams(e, "status-pdf");
  }
  if (!antrag) return new Response("Not found", { status: 404 });
  // Nur echte Antrags-Tokens. Feedback hat eine eigene Bestätigung
  // (/feedback/status/{token}/pdf) mit anderen Feldern, Leih-Tracking-Karten
  // haben gar keine — hier bewusst 404 statt einer irreführenden „Antrags"-PDF.
  // Eine Quelle für alle Antrags-Einstiege statt einer eigenen Teilprüfung.
  if ((await resolveApplicationCardId(token)) == null) {
    return new Response("Not found", { status: 404 });
  }

  const pdf = await buildConfirmationPdf({
    title: antrag.title,
    applicant: antrag.applicant,
    eingang: antrag.createdAt,
    statusLink: `${appBaseUrl()}/status/${token}`,
    number: antrag.number,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="eingangsbestaetigung.pdf"`,
      // Enthält Antragsteller/Antragsnummer — nicht in Caches ablegen.
      "Cache-Control": "private, no-store",
    },
  });
}
