// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Reine Konstanten/Funktionen (ohne DB-/Node-Imports), damit Client-Komponenten
// sie importieren können, ohne den server-only Datenzugriff in den Browser zu
// ziehen — gleiche Aufteilung wie bei `inventory-attachment-kinds.ts`.

export const FEEDBACK_MAX_LENGTH = 10_000;
export const SUBMITTER_NAME_MAX_LENGTH = 200;
/** Länge des automatisch abgeleiteten Kartentitels (inkl. Auslassungszeichen). */
export const FEEDBACK_TITLE_MAX_LENGTH = 120;

/**
 * Normalisiert den Feedbacktext für Speicherung UND Fingerprint identisch:
 * Zeilenenden auf `\n` vereinheitlichen und außen trimmen. INNERE Umbrüche und
 * Leerzeichen bleiben unangetastet — sie sind Inhalt, den der Einreicher so
 * gemeint hat (Listen, Absätze), und ein geänderter Absatz muss zu einem
 * anderen Fingerprint führen.
 */
export function normalizeFeedbackText(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/**
 * Kartentitel aus dem Feedback ableiten — das Formular hat kein Titelfeld.
 *
 * Für den TITEL (und nur dort) werden Umbrüche und Mehrfach-Leerzeichen zu
 * einzelnen Leerzeichen zusammengezogen, damit die Karte einzeilig lesbar
 * bleibt. Der vollständige Text steht unverändert in `cards.notes`.
 *
 * Gekürzt wird auf `FEEDBACK_TITLE_MAX_LENGTH` INKLUSIVE des Auslassungs-
 * zeichens; getrennt wird möglichst an einer Wortgrenze.
 */
export function deriveFeedbackTitle(feedback: string): string {
  const oneLine = feedback.replace(/\s+/g, " ").trim();
  if (oneLine.length <= FEEDBACK_TITLE_MAX_LENGTH) {
    return oneLine || "Feedback";
  }
  // Platz für das „…" freihalten.
  const cut = oneLine.slice(0, FEEDBACK_TITLE_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Nur an der Wortgrenze trennen, wenn dabei nicht zu viel verloren geht.
  const head =
    lastSpace > FEEDBACK_TITLE_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}
