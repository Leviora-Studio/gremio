// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Reine Konstanten/Funktionen (ohne DB-/Node-Imports), damit Client-Komponenten
// sie importieren können, ohne den server-only Datenzugriff in den Browser zu
// ziehen — gleiche Aufteilung wie bei `inventory-attachment-kinds.ts`.

import { sanitizeMultiLine, sanitizeSingleLine } from "@/lib/text";

export const FEEDBACK_MAX_LENGTH = 10_000;
export const SUBMITTER_NAME_MAX_LENGTH = 200;
/** Länge des automatisch abgeleiteten Kartentitels (inkl. Auslassungszeichen). */
export const FEEDBACK_TITLE_MAX_LENGTH = 120;

/** Ersatzname, wenn der Einreicher seinen Namen weglässt. */
export const ANONYMOUS_SUBMITTER = "Anonym";

/**
 * Normalisiert den Namen des Einreichers für Speicherung UND Fingerprint
 * identisch: trimmen, und wenn nichts übrig bleibt, „Anonym" einsetzen. Der
 * Name ist optional — Feedback soll auch anonym möglich sein.
 *
 * Bewusst dieselbe Funktion für beide Zwecke: Ein Retry, der einmal "" und
 * einmal "Anonym" schickt, ist logisch dieselbe Einreichung und darf deshalb
 * keinen 409 auslösen (er ergibt denselben Fingerprint).
 */
export function normalizeSubmitterName(raw: unknown): string {
  // Einzeilig bereinigen: innerer Whitespace (auch Umbrüche und Tabulatoren)
  // wird zu einfachen Leerzeichen, Steuer- und Zero-Width-Zeichen fallen weg.
  // Ohne das könnte ein Einreicher über Umbrüche im Namen zusätzliche Zeilen
  // in der PDF-Bestätigung erzeugen, und ein Name aus lauter Zero-Width-Zeichen
  // umginge den „Anonym"-Rückfall.
  const name = sanitizeSingleLine(raw);
  return name === "" ? ANONYMOUS_SUBMITTER : name;
}

/**
 * Normalisiert den Feedbacktext für Speicherung UND Fingerprint identisch:
 * Zeilenenden auf `\n` vereinheitlichen und außen trimmen. INNERE Umbrüche und
 * Leerzeichen bleiben unangetastet — sie sind Inhalt, den der Einreicher so
 * gemeint hat (Listen, Absätze), und ein geänderter Absatz muss zu einem
 * anderen Fingerprint führen.
 */
export function normalizeFeedbackText(raw: unknown): string {
  // Zusätzlich Steuerzeichen entfernen: NUL lehnt PostgreSQL ab, TAB und CR
  // sprengen den WinAnsi-Encoder der PDF-Bestätigung.
  return sanitizeMultiLine(raw);
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
  // NACH CODEPOINTS zählen und schneiden, nicht nach UTF-16-Codeunits: `slice`
  // trennt sonst mitten durch ein Surrogatpaar (z. B. 118 ASCII-Zeichen + Emoji),
  // der String wird ill-formed und PostgreSQL speichert ein U+FFFD — der
  // Kartentitel endete mit Zeichenmüll.
  const chars = Array.from(oneLine);
  if (chars.length <= FEEDBACK_TITLE_MAX_LENGTH) {
    return oneLine || "Feedback";
  }
  // Platz für das „…" freihalten.
  const cut = chars.slice(0, FEEDBACK_TITLE_MAX_LENGTH - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  // Nur an der Wortgrenze trennen, wenn dabei nicht zu viel verloren geht.
  const head =
    lastSpace > FEEDBACK_TITLE_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}
