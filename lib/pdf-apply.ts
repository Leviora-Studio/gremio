// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

// Gemeinsamer Kern für „PDF im Viewer bearbeiten + optional signieren":
// nimmt PDF-Bytes + die Editor-Eingaben entgegen und liefert das fertige PDF.
// Wird vom Inventar-Speicherpfad genutzt (der Karten-Pfad hat seine eigene,
// historisch gewachsene Variante).

import { applyPdfEdits, type FieldEdit, type TextEdit } from "@/lib/pdf-edit";
import { decryptUserCert, inspectP12 } from "@/lib/cert";
import { readSignature } from "@/lib/signature";
import { signPdf, type SignPlacement } from "@/lib/sign";
import type { User } from "@/lib/db/schema";

export type EditSignInput = {
  edits: { texts?: TextEdit[]; fields?: FieldEdit[] };
  signature?: { placement: SignPlacement; reason?: string; location?: string };
};

export type EditSignResult =
  | { ok: true; pdf: Buffer; signed: boolean; warning?: string }
  | { ok: false; error: string };

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

function sanitizeEdits(raw: EditSignInput["edits"]): {
  texts: TextEdit[];
  fields: FieldEdit[];
} {
  const texts: TextEdit[] = Array.isArray(raw?.texts)
    ? raw.texts.slice(0, 200).flatMap((t) => {
        const text = typeof t?.text === "string" ? t.text.slice(0, 2000) : "";
        const name =
          typeof t?.name === "string" && t.name ? t.name.slice(0, 200) : undefined;
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

/**
 * Wendet Freitext-/Formularfeld-Änderungen an und signiert optional mit dem
 * Zertifikat des Nutzers. Gibt das fertige PDF zurück (oder eine Fehlermeldung).
 */
export async function applyEditsAndSign(
  user: User,
  input: EditSignInput,
  inputPdf: Buffer,
): Promise<EditSignResult> {
  let pdf = inputPdf;
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
    const signatureImage = user.signaturePath
      ? ((await readSignature(user.signaturePath)) ?? undefined)
      : undefined;
    try {
      pdf = await signPdf(pdf, {
        p12: cert.p12,
        passphrase: cert.passphrase,
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

  const warning =
    failedFields.length > 0
      ? `Gespeichert, aber diese Formularfelder konnten nicht gesetzt werden: ${[
          ...new Set(failedFields),
        ].join(", ")}`
      : undefined;

  return { ok: true, pdf, signed, warning };
}
