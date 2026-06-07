// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  cards,
  cardActivity,
  attachments,
  locations,
  boards,
} from "@/lib/db/schema";
import { generateToken, isTokenConflict } from "@/lib/token";
import {
  AUSWEIS_MIME,
  PDF_MIME,
  type AttachmentKind,
} from "@/lib/constants";
import {
  deleteStoredFile,
  saveAntragFile,
  slotFileName,
  validateUpload,
} from "@/lib/attachments";
import { assignCardNumberTx } from "@/lib/numbering";
import { isHoneypotFilled, isHumanTiming } from "@/lib/antispam";
import { allowRequest } from "@/lib/rate-limit";

export type SubmitState = { error?: string; ok?: boolean };

const schema = z.object({
  locationId: z.coerce
    .number()
    .int()
    .positive("Bitte einen Standort wählen."),
  title: z.string().min(1, "Bitte einen Antragsgegenstand angeben.").max(200),
  applicant: z.string().min(1, "Bitte den Antragsteller angeben.").max(200),
});

function fileOrNull(v: FormDataEntryValue | null): File | null {
  return v instanceof File && v.size > 0 ? v : null;
}

export async function submitAntragAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  // Ratenbegrenzung pro Client (gegen Massen-Einreichungen / Disk-Fill).
  if (!(await allowRequest("submit", 5, 60_000))) {
    return { error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut." };
  }
  // Spam-Schutz: Honeypot + signierte Zeitfalle. Bots werden still verworfen
  // (gefälschte „Danke"-Bestätigung), ohne dass etwas angelegt wird.
  if (
    isHoneypotFilled(formData.get("website")) ||
    !isHumanTiming(formData.get("ts"), formData.get("sig"))
  ) {
    return { ok: true };
  }

  const parsed = schema.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    applicant: formData.get("applicant"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const [location] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, parsed.data.locationId))
    .limit(1);
  if (
    !location ||
    !location.enabled ||
    !location.targetBoardId ||
    !location.targetStatusId
  ) {
    return { error: "Der gewählte Standort ist nicht verfügbar." };
  }

  // Pflicht-Dateien
  const finance_request = fileOrNull(formData.get("finance_request"));
  const ausweis = fileOrNull(formData.get("student_card"));
  if (!finance_request) return { error: "Finanzantrag (PDF) ist erforderlich." };
  if (!ausweis) return { error: "Studierendenausweis ist erforderlich." };

  const anlageA = fileOrNull(formData.get("annex_a"));
  const anlageB = fileOrNull(formData.get("annex_b"));

  // Validierung
  const checks: { file: File; allowed: string[]; kind: AttachmentKind }[] = [
    { file: finance_request, allowed: PDF_MIME, kind: "finance_request" },
    { file: ausweis, allowed: AUSWEIS_MIME, kind: "student_card" },
  ];
  if (anlageA) checks.push({ file: anlageA, allowed: PDF_MIME, kind: "annex_a" });
  if (anlageB) checks.push({ file: anlageB, allowed: PDF_MIME, kind: "annex_b" });
  for (const c of checks) {
    const err = validateUpload(c.file, c.allowed);
    if (err) return { error: `${c.kind}: ${err}` };
  }

  // Zielposition (ans Ende der Ziel-Spalte) und Standardkonto vorab lesen.
  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(
        eq(cards.boardId, location.targetBoardId),
        eq(cards.statusId, location.targetStatusId),
      ),
    );
  const [board] = await db
    .select({ defaultAccountId: boards.defaultAccountId })
    .from(boards)
    .where(eq(boards.id, location.targetBoardId))
    .limit(1);
  const position = (maxRow?.m ?? -1) + 1;
  // Geprüfte Ziel-IDs in Consts ziehen (Narrowing bleibt so in der Closure).
  const targetBoardId = location.targetBoardId;
  const targetStatusId = location.targetStatusId;

  // Antrag atomar anlegen: Karte + Aktivität + Antragsnummer + Anhänge in EINER
  // Transaktion (kein halber Antrag bei Fehlern). Token-Kollision (faktisch
  // unmöglich) wird durch erneutes Würfeln abgefangen.
  let token = "";
  const writtenPaths: string[] = [];
  try {
    for (let attempt = 0; ; attempt++) {
      token = generateToken();
      writtenPaths.length = 0;
      try {
        await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(cards)
            .values({
              boardId: targetBoardId,
              statusId: targetStatusId,
              locationId: location.id,
              title: parsed.data.title,
              applicant: parsed.data.applicant,
              token,
              accountId: board?.defaultAccountId ?? null,
              position,
            })
            .returning();
          await tx.insert(cardActivity).values({
            cardId: inserted.id,
            userId: null,
            type: "created",
            detail: "Antrag über das öffentliche Formular eingereicht",
          });
          // Antragsnummer vergeben (falls aktiv) — die Anhänge werden danach
          // automatisch nach dem Schema „<Antragsnummer>_<Label>" benannt.
          const number = await assignCardNumberTx(tx, targetBoardId, inserted.id);
          for (const c of checks) {
            const saved = await saveAntragFile(inserted.id, c.file);
            writtenPaths.push(saved.relPath);
            await tx.insert(attachments).values({
              cardId: inserted.id,
              kind: c.kind,
              filename: slotFileName(c.kind, saved.filename, number),
              path: saved.relPath,
              mime: saved.mime,
              size: saved.size,
            });
          }
        });
        break; // erfolgreich angelegt
      } catch (e) {
        // Transaktion rollte zurück → bereits geschriebene Dateien entfernen
        // (sonst Datei-Leichen im Upload-Verzeichnis).
        for (const p of writtenPaths) await deleteStoredFile(p);
        writtenPaths.length = 0;
        // Nur bei Token-Duplikat neu würfeln; sonst weiterwerfen.
        if (isTokenConflict(e) && attempt < 5) continue;
        throw e;
      }
    }
  } catch {
    return {
      error:
        "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
    };
  }

  redirect(`/status/${token}`);
}
