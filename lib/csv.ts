// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

/**
 * Eine CSV-Zelle für den Semikolon-getrennten Export escapen — inkl. Schutz vor
 * CSV-Formel-Injection: Werte, die mit `= + - @` (oder Tab/CR) beginnen, werden
 * von Excel/LibreOffice sonst als Formel ausgeführt (z. B. `=HYPERLINK(...)`,
 * DDE). Solche Werte bekommen ein führendes Apostroph (Text-Marker), danach
 * normales Quoting bei `"`, `;` oder Zeilenumbrüchen.
 */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Eine Zeile (Zellen) mit Semikolon verbinden. */
export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(";");
}

/** Vollständige CSV mit BOM (Excel-DE öffnet UTF-8/Umlaute korrekt). */
export function buildCsv(
  rows: (string | number | null | undefined)[][],
): string {
  return "﻿" + rows.map(csvRow).join("\r\n");
}
