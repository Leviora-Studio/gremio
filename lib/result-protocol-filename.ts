// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { validateFilePattern } from "./protocol-markdown";

export const RESULT_PROTOCOL_FILENAME = "Ergebnisprotokoll.md";

const DATE_PATTERN = /\{(?:YYYY|MM|DD|date)\}/;

export function renderResultProtocolFilename(
  pattern: string,
  areaName: string,
  folderName: string,
  sessionDate: string | null,
  sourceFilename?: string,
): string {
  if (!sessionDate && DATE_PATTERN.test(pattern)) {
    throw new Error("Für das Namensschema der Ergebnisprotokolldatei muss ein Sitzungsdatum erkannt sein.");
  }
  const filename = validateFilePattern(pattern, sessionDate ?? "2000-01-01", areaName, folderName);
  if (sourceFilename && filename.normalize().toLocaleLowerCase("de-DE") === sourceFilename.normalize().toLocaleLowerCase("de-DE")) {
    throw new Error("Verlaufs- und Ergebnisprotokolldatei müssen unterschiedliche Namen haben.");
  }
  return filename;
}
