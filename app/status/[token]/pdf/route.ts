// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { appBaseUrl } from "@/lib/public-api";
import { buildConfirmationPdf } from "@/lib/pdf";
import { isFeedbackToken } from "@/lib/public-feedback-submission";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [antrag] = await db
    .select()
    .from(cards)
    .where(eq(cards.token, token))
    .limit(1);
  if (!antrag) return new Response("Not found", { status: 404 });
  // Feedback hat eine eigene Bestätigung (/feedback/status/{token}/pdf) mit
  // anderen Feldern — hier bewusst 404 statt einer irreführenden „Antrags"-PDF.
  if (await isFeedbackToken(token)) {
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
