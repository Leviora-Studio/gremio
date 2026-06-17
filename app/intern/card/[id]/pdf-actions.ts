// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  absPath,
  deleteStoredFile,
  saveAntragBuffer,
} from "@/lib/attachments";
import { logActivity } from "@/lib/activity";
import { allowRequest } from "@/lib/rate-limit";
import { applyPdfEdits, type FieldEdit, type TextEdit } from "@/lib/pdf-edit";
import { decryptUserCert } from "@/lib/cert";
import { signPdf, type SignPlacement } from "@/lib/sign";

export type SavePdfInput = {
  attachmentId: number;
  mode: "new" | "replace";
  edits: { texts?: TextEdit[]; fields?: FieldEdit[] };
  signature?: { placement: SignPlacement; reason?: string; location?: string };
};

export type SavePdfResult =
  | { ok: true; attachmentId: number; signed: boolean }
  | { ok: false; error: string };

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/** Eingaben defensiv begrenzen (manipuliertes RPC darf nicht 500en). */
function sanitizeEdits(raw: SavePdfInput["edits"]): {
  texts: TextEdit[];
  fields: FieldEdit[];
} {
  const texts: TextEdit[] = Array.isArray(raw?.texts)
    ? raw.texts.slice(0, 200).flatMap((t) => {
        const text = typeof t?.text === "string" ? t.text.slice(0, 2000) : "";
        if (!text.trim()) return [];
        const page = Number.isInteger(t?.page) ? (t.page as number) : 0;
        return [
          {
            page: Math.max(0, page),
            xRatio: clamp01(t?.xRatio),
            yRatio: clamp01(t?.yRatio),
            text,
            sizeRatio: t?.sizeRatio ? clamp01(t.sizeRatio) : undefined,
          },
        ];
      })
    : [];
  const fields: FieldEdit[] = Array.isArray(raw?.fields)
    ? raw.fields.slice(0, 500).flatMap((f) => {
        if (typeof f?.name !== "string" || !f.name) return [];
        const value =
          typeof f.value === "boolean"
            ? f.value
            : String(f.value ?? "").slice(0, 5000);
        return [{ name: f.name.slice(0, 500), value }];
      })
    : [];
  return { texts, fields };
}

function sanitizePlacement(p: SignPlacement): SignPlacement {
  return {
    page: Number.isInteger(p?.page) ? Math.max(0, p.page) : 0,
    xRatio: clamp01(p?.xRatio),
    yRatio: clamp01(p?.yRatio),
    wRatio: Math.max(0.05, clamp01(p?.wRatio)),
    hRatio: Math.max(0.02, clamp01(p?.hRatio)),
  };
}

/** Fügt vor der .pdf-Endung ein Suffix ein (z. B. „antrag_signiert.pdf"). */
function withSuffix(filename: string, suffix: string): string {
  const dot = filename.toLowerCase().lastIndexOf(".pdf");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}_${suffix}.pdf`.slice(0, 180);
}

/**
 * Speichert die im Viewer vorgenommenen PDF-Änderungen (Freitext + Formular-
 * felder) und optional eine kryptografische Signatur mit dem Zertifikat des
 * Nutzers. „new" legt eine zusätzliche Datei an (Original bleibt erhalten),
 * „replace" ersetzt den Anhang in-place. Board-Zugriff erforderlich.
 */
export async function savePdfEditsAction(
  input: SavePdfInput,
): Promise<SavePdfResult> {
  const user = await requireUser();
  if (!input || !Number.isInteger(input.attachmentId)) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) {
    return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  }
  const mode = input.mode === "replace" ? "replace" : "new";

  const [att] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, input.attachmentId))
    .limit(1);
  if (!att) return { ok: false, error: "Anhang nicht gefunden." };
  if (att.mime !== "application/pdf") {
    return { ok: false, error: "Nur PDF-Dateien können bearbeitet werden." };
  }

  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.id, att.cardId))
    .limit(1);
  if (!card) return { ok: false, error: "Karte nicht gefunden." };
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return { ok: false, error: "Kein Zugriff auf dieses Board." };
  }

  let pdf: Buffer;
  try {
    pdf = await readFile(absPath(att.path));
  } catch {
    return { ok: false, error: "Originaldatei nicht lesbar." };
  }

  const edits = sanitizeEdits(input.edits);
  const hasEdits = edits.texts.length > 0 || edits.fields.length > 0;
  if (hasEdits) {
    try {
      pdf = await applyPdfEdits(pdf, edits);
    } catch {
      return { ok: false, error: "Die Bearbeitung konnte nicht angewendet werden." };
    }
  }

  let signed = false;
  if (input.signature) {
    const cert = decryptUserCert(user);
    if (!cert) {
      return {
        ok: false,
        error:
          "Kein Signatur-Zertifikat hinterlegt — bitte zuerst in den Konto-Einstellungen hinzufügen.",
      };
    }
    if (user.certNotAfter && user.certNotAfter <= new Date()) {
      return { ok: false, error: "Dein Signatur-Zertifikat ist abgelaufen." };
    }
    const dateLabel =
      new Date().toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " Uhr";
    try {
      pdf = await signPdf(pdf, {
        p12: cert.p12,
        passphrase: cert.passphrase,
        signerName: user.name ?? user.username,
        dateLabel,
        reason:
          typeof input.signature.reason === "string"
            ? input.signature.reason.slice(0, 120)
            : undefined,
        location:
          typeof input.signature.location === "string"
            ? input.signature.location.slice(0, 120)
            : undefined,
        placement: sanitizePlacement(input.signature.placement),
      });
      signed = true;
    } catch {
      return {
        ok: false,
        error: "Signieren fehlgeschlagen — Zertifikat oder Passwort prüfen.",
      };
    }
  }

  if (!hasEdits && !signed) {
    return { ok: false, error: "Keine Änderungen zum Speichern." };
  }

  const noun = signed ? "signiert" : "bearbeitet";

  if (mode === "replace") {
    const saved = await saveAntragBuffer(card.id, att.filename, pdf, "application/pdf");
    const oldPath = att.path;
    await db.transaction(async (tx) => {
      await tx
        .update(attachments)
        .set({
          path: saved.relPath,
          size: saved.size,
          mime: "application/pdf",
          uploadedAt: new Date(),
          uploadedBy: user.id,
        })
        .where(eq(attachments.id, att.id));
      await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
    });
    await deleteStoredFile(oldPath);
    await logActivity(
      card.id,
      user.id,
      "attachment_added",
      `PDF ${noun} (ersetzt): ${att.filename}`,
    );
    revalidatePath(`/intern/card/${card.id}`);
    return { ok: true, attachmentId: att.id, signed };
  }

  const newName = withSuffix(att.filename, noun);
  const saved = await saveAntragBuffer(card.id, newName, pdf, "application/pdf");
  const [ins] = await db
    .insert(attachments)
    .values({
      cardId: card.id,
      kind: "other",
      filename: newName,
      path: saved.relPath,
      mime: "application/pdf",
      size: saved.size,
      uploadedBy: user.id,
    })
    .returning({ id: attachments.id });
  await db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
  await logActivity(
    card.id,
    user.id,
    "attachment_added",
    `PDF ${noun} (neue Datei): ${newName}`,
  );
  revalidatePath(`/intern/card/${card.id}`);
  return { ok: true, attachmentId: ins.id, signed };
}
