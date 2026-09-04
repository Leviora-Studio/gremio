// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/**
 * Erkennt die automatisch erzeugten Namen und gleich benannte manuelle
 * Uploads. Ein historisches, unnummeriertes `Anweisung.pdf` zählt als 1.
 */
export function instructionNumber(filename: string): number | null {
  const match = /^Anweisung(?:\s+(\d+))?\.pdf$/i.exec(filename.trim());
  if (!match) return null;
  if (!match[1]) return 1;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Fortlaufend ab dem höchsten vorhandenen Namen (nicht erste Lücke). Dadurch
 * folgt auf einen manuell hochgeladenen `Anweisung 2.pdf` sicher Nummer 3.
 */
export function nextInstructionFilename(existingFilenames: string[]): string {
  let highest = 0;
  for (const filename of existingFilenames) {
    const number = instructionNumber(filename);
    if (number != null) highest = Math.max(highest, number);
  }
  return `Anweisung ${highest + 1}.pdf`;
}
