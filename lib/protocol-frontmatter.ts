// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { isMap, parseDocument } from "yaml";

export const protocolMetadataFields = [
  ["title", "Titel"], ["author", "Autor (PDF-Metadaten)"],
  ["sitzungsdatum", "Sitzungsdatum"], ["beginn", "Beginn"], ["ende", "Ende"],
  ["sitzungsort", "Sitzungsort"], ["sitzungsleitung", "Sitzungsleitung"],
  ["protokollfuehrung", "Protokollführung"], ["logo", "Logo-Dateiname (optional)"],
] as const;
export type ProtocolMetadataKey = typeof protocolMetadataFields[number][0];
export type ProtocolMetadata = Record<ProtocolMetadataKey, string> & { unterschriften: boolean };
const aliases: Partial<Record<ProtocolMetadataKey, string[]>> = {
  sitzungsleitung: ["sitzungsleitung", "sitzungsleiter", "sitzungsleiterin"],
  protokollfuehrung: ["protokollfuehrung", "protokollfuehrer", "protokollfuehrerin"],
};

/** Offsets stay in the original source so editors never rewrite unrelated content. */
export function protocolFrontmatterRange(source: string) {
  const opening = /^(?:\uFEFF)?[ \t]*(?:\r?\n[ \t]*)*---[ \t]*\r?\n/.exec(source);
  if (!opening) return null;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(source.slice(opening[0].length));
  if (!closing) return { start: opening[0].length, end: source.length, bodyStart: source.length, closed: false };
  const end = opening[0].length + closing.index;
  return { start: opening[0].length, end, bodyStart: end + closing[0].length, closed: true };
}

export function parseProtocolFrontmatter(source: string) {
  const range = protocolFrontmatterRange(source);
  if (range && !range.closed) throw new Error("Der YAML-Kopf ist nicht mit einer eigenen --- Zeile abgeschlossen.");
  const header = range ? source.slice(range.start, range.end) : "";
  if (header.length > 32_000) throw new Error("Der YAML-Kopf ist zu groß (maximal 32 KB).");
  const document = parseDocument(header, { uniqueKeys: true, version: "1.2", strict: true });
  if (document.errors.length || (document.contents && !isMap(document.contents))) throw new Error("Ungültiger YAML-Kopf. Bitte Schlüssel und Einrückung im Modus Bearbeiten prüfen.");
  let meta: Record<string, unknown>;
  try { meta = document.toJS({ maxAliasCount: 0 }) ?? {}; }
  catch { throw new Error("YAML-Verweise und rekursive Strukturen werden im Protokollkopf nicht unterstützt."); }
  const fields = {} as ProtocolMetadata;
  for (const [key] of protocolMetadataFields) {
    fields[key] = "";
    for (const alias of aliases[key] ?? [key]) {
      const value = meta[alias];
      if (value === null || value === undefined || value === "") continue;
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`Das YAML-Feld „${alias}“ muss ein einfacher Wert sein.`);
      const text = String(value).trim();
      if (text.length > 2000) throw new Error(`Das YAML-Feld „${alias}“ ist zu lang.`);
      if (text) { fields[key] = text; break; }
    }
  }
  fields.unterschriften = !["false", "nein", "no", "0", "off"].includes(String(meta.unterschriften ?? "").trim().toLowerCase());
  return { document, range, fields, body: range ? source.slice(range.bodyStart) : source };
}

export function updateProtocolFrontmatter(source: string, changes: Partial<ProtocolMetadata>) {
  const { document, range } = parseProtocolFrontmatter(source);
  for (const [key] of protocolMetadataFields) {
    if (!(key in changes)) continue;
    const value = changes[key];
    if (typeof value !== "string" || value.length > 2000) throw new Error(`Ungültiger Wert für „${key}“.`);
    for (const alias of aliases[key] ?? [key]) if (document.has(alias)) document.delete(alias);
    if (value.trim()) document.set(key, value.trim());
  }
  if ("unterschriften" in changes) document.set("unterschriften", Boolean(changes.unterschriften));
  if (!document.contents) return source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const header = document.toString({ lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }).replace(/\n/g, newline);
  return `---${newline}${header}---${newline}${range ? source.slice(range.bodyStart) : `${newline}${source}`}`;
}
