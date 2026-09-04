// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cardActivity, cards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  absPath,
  deleteStoredFile,
  saveAntragBuffer,
} from "@/lib/attachments";
import { allowRequest } from "@/lib/rate-limit";
import { applyPdfEdits, type FieldEdit, type TextEdit } from "@/lib/pdf-edit";
import { decryptUserCert, inspectP12 } from "@/lib/cert";
import { readSignature } from "@/lib/signature";
import { signPdf, type SignPlacement } from "@/lib/sign";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";

export type SavePdfInput = {
  attachmentId: number;
  mode: "new" | "replace";
  /** Optionaler Versionsanker für Quellen, die kein normaler Anhang sind. */
  sourceVersion?: string;
  edits: { texts?: TextEdit[]; fields?: FieldEdit[] };
  signature?: { placement: SignPlacement; reason?: string; location?: string };
};

export type SavePdfResult =
  | { ok: true; attachmentId: number; signed: boolean; warning?: string }
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
        const name =
          typeof t?.name === "string" && t.name ? t.name.slice(0, 200) : undefined;
        // Neue, leere Texte ignorieren; bestehende (mit name) auch leer zulassen
        // (→ Inhalt löschen).
        if (!name && !text.trim()) return [];
        const page = Number.isInteger(t?.page) ? (t.page as number) : 0;
        return [
          {
            name,
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
  if (
    !input ||
    !Number.isSafeInteger(input.attachmentId) ||
    input.attachmentId < 1 ||
    input.attachmentId > 2_147_483_647 ||
    (input.mode !== "new" && input.mode !== "replace")
  ) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) {
    return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  }
  const mode = input.mode;

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
  const visible = await getVisibleFieldKeys(board.id);
  if (!isCardAttachmentVisible(att, visible)) {
    return { ok: false, error: "Dieses Dateifeld ist auf dem Board nicht aktiviert." };
  }
  if (mode === "new" && !visible.has("other_pdfs")) {
    return {
      ok: false,
      error: "Das Feld für weitere PDF-Dateien ist auf dem Board nicht aktiviert.",
    };
  }

  let pdf: Buffer;
  try {
    pdf = await readFile(absPath(att.path));
  } catch {
    return { ok: false, error: "Originaldatei nicht lesbar." };
  }

  const edits = sanitizeEdits(input.edits);
  const hasEdits = edits.texts.length > 0 || edits.fields.length > 0;
  let failedFields: string[] = [];
  if (hasEdits) {
    try {
      const res = await applyPdfEdits(pdf, edits);
      pdf = res.pdf;
      failedFields = res.failed;
    } catch (e) {
      console.error("[pdf-edit] applyPdfEdits failed:", e);
      return { ok: false, error: "Die Bearbeitung konnte nicht angewendet werden." };
    }
  }

  let signed = false;
  if (input.signature) {
    // Entschlüsseln kann werfen (z. B. beschädigter/leerer Geheimwert) → abfangen
    // und freundlich melden statt 500.
    let cert: { p12: Buffer; passphrase: string } | null;
    try {
      cert = decryptUserCert(user);
    } catch (e) {
      console.error("[pdf-sign] cert decrypt failed:", e);
      return {
        ok: false,
        error:
          "Signatur-Zertifikat konnte nicht entschlüsselt werden — bitte in den Konto-Einstellungen neu hinterlegen.",
      };
    }
    if (!cert) {
      return {
        ok: false,
        error:
          "Kein Signatur-Zertifikat hinterlegt — bitte zuerst in den Konto-Einstellungen hinzufügen.",
      };
    }
    // Gültigkeit FRISCH aus dem Zertifikat prüfen (notBefore UND notAfter, nicht
    // nur die gespeicherte Spalte); validiert nebenbei die Passphrase.
    try {
      const info = inspectP12(cert.p12, cert.passphrase);
      const now = new Date();
      if (info.notBefore > now) {
        return { ok: false, error: "Dein Signatur-Zertifikat ist noch nicht gültig." };
      }
      if (info.notAfter <= now) {
        return { ok: false, error: "Dein Signatur-Zertifikat ist abgelaufen." };
      }
    } catch (e) {
      console.error("[pdf-sign] cert inspect failed:", e);
      return {
        ok: false,
        error:
          "Signatur-Zertifikat oder Passwort ungültig — bitte in den Konto-Einstellungen prüfen.",
      };
    }
    const dateLabel =
      new Date().toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " Uhr";
    // Optionales Unterschriftsbild (rein optisch) laden, falls hinterlegt.
    const signatureImage = user.signaturePath
      ? ((await readSignature(user.signaturePath)) ?? undefined)
      : undefined;
    try {
      pdf = await signPdf(pdf, {
        p12: cert.p12,
        passphrase: cert.passphrase,
        // Auf dem PDF erscheint der Name AUS DEM ZERTIFIKAT (Subject/CN), nicht
        // der Gremio-Benutzername. Fallback nur, falls kein CN gelesen wurde.
        signerName: user.certSubject?.trim() || user.name || user.username,
        dateLabel,
        signatureImage,
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
    } catch (e) {
      console.error("[pdf-sign] signPdf failed:", e);
      return {
        ok: false,
        error: "Signieren fehlgeschlagen — Zertifikat oder Passwort prüfen.",
      };
    }
  }

  if (!hasEdits && !signed) {
    return { ok: false, error: "Keine Änderungen zum Speichern." };
  }
  if (pdf.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Die bearbeitete PDF-Datei ist größer als 25 MB und wurde nicht gespeichert.",
    };
  }

  const noun = signed ? "signiert" : "bearbeitet";
  // Teil-Erfolg sichtbar machen: gespeichert, aber einzelne Felder gingen nicht.
  const warning =
    failedFields.length > 0
      ? `Gespeichert, aber diese Formularfelder konnten nicht gesetzt werden: ${[
          ...new Set(failedFields),
        ].join(", ")}`
      : undefined;

  if (mode === "replace") {
    const saved = await saveAntragBuffer(card.id, att.filename, pdf, "application/pdf");
    const oldPath = att.path;
    try {
      await db.transaction(async (tx) => {
        const [lockedCard] = await tx
          .select({ id: cards.id })
          .from(cards)
          .where(eq(cards.id, card.id))
          .for("update");
        const [current] = await tx
          .select({ path: attachments.path })
          .from(attachments)
          .where(
            and(
              eq(attachments.id, att.id),
              eq(attachments.cardId, card.id),
            ),
          )
          .for("update");
        if (!lockedCard || !current || current.path !== oldPath) {
          throw new Error("attachment-changed");
        }
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
        await tx
          .update(cards)
          .set({ updatedAt: new Date() })
          .where(eq(cards.id, card.id));
        await tx.insert(cardActivity).values({
          cardId: card.id,
          userId: user.id,
          type: "attachment_added",
          detail: `PDF ${noun} (ersetzt): ${att.filename}`,
        });
      });
    } catch (error) {
      await deleteStoredFile(saved.relPath);
      if ((error as Error)?.message === "attachment-changed") {
        return {
          ok: false,
          error: "Die PDF-Datei wurde inzwischen geändert oder gelöscht. Bitte neu öffnen.",
        };
      }
      console.error("[pdf-edit] replace failed:", error);
      return { ok: false, error: "Die PDF-Datei konnte nicht gespeichert werden." };
    }
    await deleteStoredFile(oldPath);
    revalidatePath(`/intern/card/${card.id}`);
    return { ok: true, attachmentId: att.id, signed, warning };
  }

  const newName = withSuffix(att.filename, noun);
  const saved = await saveAntragBuffer(card.id, newName, pdf, "application/pdf");
  let attachmentId: number;
  try {
    attachmentId = await db.transaction(async (tx) => {
      const [lockedCard] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.id, card.id))
        .for("update");
      const [current] = await tx
        .select({ path: attachments.path })
        .from(attachments)
        .where(
          and(eq(attachments.id, att.id), eq(attachments.cardId, card.id)),
        )
        .for("update");
      if (!lockedCard || !current || current.path !== att.path) {
        throw new Error("attachment-changed");
      }
      const [inserted] = await tx
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
      await tx
        .update(cards)
        .set({ updatedAt: new Date() })
        .where(eq(cards.id, card.id));
      await tx.insert(cardActivity).values({
        cardId: card.id,
        userId: user.id,
        type: "attachment_added",
        detail: `PDF ${noun} (neue Datei): ${newName}`,
      });
      return inserted.id;
    });
  } catch (error) {
    await deleteStoredFile(saved.relPath);
    if ((error as Error)?.message === "attachment-changed") {
      return {
        ok: false,
        error: "Die PDF-Datei wurde inzwischen geändert oder gelöscht. Bitte neu öffnen.",
      };
    }
    console.error("[pdf-edit] create copy failed:", error);
    return { ok: false, error: "Die PDF-Kopie konnte nicht gespeichert werden." };
  }
  revalidatePath(`/intern/card/${card.id}`);
  return { ok: true, attachmentId, signed, warning };
}
