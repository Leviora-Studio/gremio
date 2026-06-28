// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { MAX_UPLOAD_BYTES, type AttachmentKind } from "@/lib/constants";

// Anzeige-Labels der benannten Slots für den automatischen Dateinamen.
// 'other' (Weitere PDFs / Quittungen) ist bewusst NICHT enthalten → bleibt
// unter seinem Originalnamen (Quittungen benennt der Antragsteller selbst).
const SLOT_LABEL: Partial<Record<AttachmentKind, string>> = {
  finance_request: "Finanzantrag",
  annex_a: "AnlageA",
  annex_b: "AnlageB",
  student_card: "Studierendenausweis",
};

/** Endung (mit Punkt, klein) aus einem Dateinamen; "" wenn keine plausible. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = name.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/**
 * Anzeigename eines benannten Slot-Anhangs: `<Antragsnummer>_<Label><ext>`
 * (z. B. „A03_2026_KÖT_Finanzantrag.pdf"). Die Endung wird aus dem hoch-
 * geladenen Original übernommen (Ausweis kann PNG/JPG sein). Ohne Antrags-
 * nummer entfällt der Präfix (nur `<Label><ext>`). Für 'other' bleibt der
 * Originalname unverändert. Umlaute bleiben erhalten; nur pfad-/header-
 * unsichere Zeichen werden entschärft.
 */
export function slotFileName(
  kind: AttachmentKind,
  originalName: string,
  cardNumber: string | null,
): string {
  const label = SLOT_LABEL[kind];
  if (!label) return originalName; // 'other' unverändert
  const num = cardNumber?.trim();
  const base = num ? `${num}_${label}` : label;
  return `${base.replace(/[\\/\r\n"]+/g, "_")}${extensionOf(originalName)}`;
}

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** MIME ermitteln (Browser-Typ, sonst Endung). */
export function resolveMime(file: File): string {
  if (file.type) return file.type;
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

// Antragsformular-Dokumente werden mit einer aus der (bereits whitelisted)
// ENDUNG abgeleiteten MIME gespeichert/ausgeliefert — NIE mit dem fälschbaren
// Browser-Typ. So kann z. B. keine als „x.png" getarnte SVG als image/svg+xml
// inline laufen (Stored-XSS). Unbekannt → octet-stream (Download).
const FORM_DOC_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

/** Sichere MIME für Antragsformular-Dokumente aus der Endung (nicht dem Browser). */
export function formDocMime(filename: string): string {
  return FORM_DOC_MIME[extensionOf(filename)] ?? "application/octet-stream";
}

/**
 * RFC-5987-konformer Content-Disposition-Wert. HTTP-Header-Werte sind Latin-1 —
 * ein Dateiname mit Nicht-ASCII (z. B. „Ö") lässt `new Response(...)` sonst
 * werfen (→ 500). Daher: reiner ASCII-Fallback (filename=) PLUS UTF-8-Variante
 * (filename*=), sodass Browser den korrekten Originalnamen anzeigen.
 */
export function contentDisposition(
  filename: string,
  type: "inline" | "attachment" = "attachment",
): string {
  const ascii =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "") // alles außerhalb druckbarem ASCII raus
      .replace(/["\\]/g, "_")
      .trim() || "datei";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Upload validieren. Gibt Fehlermeldung zurück oder null. */
export function validateUpload(file: File, allowedMime: string[]): string | null {
  if (!file || file.size === 0) return "Keine Datei ausgewählt.";
  if (file.size > MAX_UPLOAD_BYTES)
    return `Datei zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`;
  const mime = resolveMime(file);
  if (!allowedMime.includes(mime)) {
    return "Dateityp nicht erlaubt.";
  }
  return null;
}

function sanitize(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "datei";
}

export function absPath(relPath: string): string {
  return join(env.UPLOAD_DIR, relPath);
}

/** Datei eines Antrags speichern; gibt relativen Pfad + Metadaten zurück. */
export async function saveAntragFile(
  cardId: number,
  file: File,
): Promise<{ relPath: string; filename: string; mime: string; size: number }> {
  const buf = Buffer.from(await file.arrayBuffer());
  const rel = join(
    "cards",
    String(cardId),
    `${randomUUID()}-${sanitize(file.name)}`,
  );
  const abs = absPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return {
    relPath: rel,
    filename: file.name,
    mime: resolveMime(file),
    size: buf.length,
  };
}

/** Generischer Datei-Upload in ein Unterverzeichnis (z. B. „form-documents"). */
export async function saveNamedFile(
  subdir: string,
  file: File,
): Promise<{ relPath: string; filename: string; mime: string; size: number }> {
  const buf = Buffer.from(await file.arrayBuffer());
  const rel = join(subdir, `${randomUUID()}-${sanitize(file.name)}`);
  const abs = absPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return {
    relPath: rel,
    filename: file.name,
    mime: resolveMime(file),
    size: buf.length,
  };
}

/** Wie saveNamedFile, aber für bereits aufbereitete Bytes (z. B. signiertes PDF). */
export async function saveNamedBuffer(
  subdir: string,
  filename: string,
  buf: Buffer,
  mime: string,
): Promise<{ relPath: string; filename: string; mime: string; size: number }> {
  const rel = join(subdir, `${randomUUID()}-${sanitize(filename)}`);
  const abs = absPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { relPath: rel, filename, mime, size: buf.length };
}

/** Wie saveAntragFile, aber für bereits aufbereitete Bytes (z. B. signiertes PDF). */
export async function saveAntragBuffer(
  cardId: number,
  filename: string,
  buf: Buffer,
  mime: string,
): Promise<{ relPath: string; filename: string; mime: string; size: number }> {
  const rel = join(
    "cards",
    String(cardId),
    `${randomUUID()}-${sanitize(filename)}`,
  );
  const abs = absPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { relPath: rel, filename, mime, size: buf.length };
}

export async function deleteStoredFile(relPath: string): Promise<void> {
  try {
    await unlink(absPath(relPath));
  } catch {
    // Datei evtl. schon weg — ignorieren.
  }
}
