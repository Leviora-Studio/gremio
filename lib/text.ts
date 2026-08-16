// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/**
 * Bereinigung freier Nutzertexte an der EINGANGSGRENZE.
 *
 * Zweck ist, dass nichts in die Datenbank gelangt, was später Ausgabewege
 * sprengt. Konkret sind das zwei Klassen von Zeichen:
 *
 *  - **NUL (U+0000)** — PostgreSQL lehnt es in `text` ab. Es ist kein
 *    Whitespace, überlebt also `trim()` und eine `min(1)`-Prüfung; der Insert
 *    wirft erst ganz am Ende.
 *  - **TAB, CR und übrige C0-Steuerzeichen** — der WinAnsi-Encoder von
 *    `pdf-lib` kann sie nicht darstellen und wirft beim Zeichnen. Ein
 *    Tabulator aus einer kopierten Tabelle reichte, um die
 *    Eingangsbestätigung dauerhaft auf HTTP 500 zu legen.
 *
 * Die PDF-Erzeugung entschärft dieselben Zeichen zwar inzwischen ebenfalls
 * (`winAnsiSafe`), aber Reparatur an der Ausgabe ersetzt keine saubere
 * Eingabe: Der Titel einer Karte soll auch in der Weboberfläche und im Export
 * keinen Tabulator enthalten.
 *
 * Alle Zeichenklassen stehen bewusst als Escape-Sequenz statt als literales
 * Steuerzeichen im Quelltext — literale Steuerzeichen sind unsichtbar und
 * gehen bei Copy&Paste oder durch einen Formatter verloren.
 */

/** Zero-Width-Zeichen, die optisch leer sind, aber `trim()` überleben. */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Einzeiliger Text (Titel, Namen): Alle Whitespace-Folgen — auch Umbrüche und
 * Tabulatoren — werden zu einem einfachen Leerzeichen zusammengezogen, danach
 * getrimmt. Zero-Width-Zeichen fallen weg, damit ein Name, der nur aus ihnen
 * besteht, als leer gilt.
 */
export function sanitizeSingleLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      .replace(ZERO_WIDTH, "")
      // C0 ohne TAB/LF/CR — die drei erledigt die \s-Zusammenfassung darunter.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Mehrzeiliger Freitext (Feedback): Zeilenenden werden auf `\n` vereinheitlicht
 * und außen getrimmt. INNERE Umbrüche und Leerzeichen bleiben erhalten — sie
 * sind Inhalt (Listen, Absätze), und ein geänderter Absatz muss zu einem
 * anderen Idempotenz-Fingerprint führen.
 *
 * Tabulatoren werden zu einem Leerzeichen, übrige Steuerzeichen entfallen.
 */
export function sanitizeMultiLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(ZERO_WIDTH, "")
      // C0 ohne LF — TAB und CR sind oben bereits ersetzt.
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
      .trim()
  );
}
