// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatDateTime } from "@/lib/dates";

/**
 * Macht freien Nutzertext für die WinAnsi-Standardschrift sicher: häufige
 * Typografie-Zeichen auf ASCII abbilden, alles außerhalb von Latin-1
 * (Emoji, nicht-lateinische Schriften) durch "?" ersetzen — sonst wirft
 * pdf-lib "WinAnsi cannot encode …" und der PDF-Abruf liefert 500.
 */
export function winAnsiSafe(s: string, opts: { keepNewlines?: boolean } = {}): string {
  const mapped = (s ?? "")
    .replace(/[‘’‚′´`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR");
  let out = "";
  for (const ch of mapped) {
    const c = ch.codePointAt(0) ?? 0;
    // ACHTUNG: TAB (9), LF (10) und CR (13) sind für den WinAnsi-Encoder von
    // pdf-lib KEINE darstellbaren Zeichen — `drawText` wirft daran. Früher
    // ließ diese Funktion sie ausdrücklich durch und war damit die Ursache
    // dauerhafter 500er auf den Eingangsbestätigungen.
    //   TAB → Leerzeichen, CR → verworfen (Zeilenenden sind vorher auf \n
    //   normalisiert), LF nur, wenn der aufrufende Builder selbst umbricht.
    if (c === 9) {
      out += " ";
      continue;
    }
    if (c === 13) continue;
    if (c === 10) {
      out += opts.keepNewlines ? ch : " ";
      continue;
    }
    // druckbares ASCII (0x20–0x7E) und Latin-1 (0xA0–0xFF: ä ö ü ß …).
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
    out += ok ? ch : "?";
  }
  return out;
}

/**
 * Bricht Text auf eine gegebene Breite um: primär an Wortgrenzen, überlange
 * „Wörter" (URLs, zusammengeschriebene Ketten) hart auf Zeichenebene. Liefert
 * immer mindestens eine Zeile.
 */
function wrapText(
  s: string,
  f: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const word of s.split(" ")) {
    let w = word;
    while (f.widthOfTextAtSize(w, size) > maxWidth) {
      let i = 1;
      while (i < w.length && f.widthOfTextAtSize(w.slice(0, i + 1), size) <= maxWidth) i++;
      if (cur) push();
      out.push(w.slice(0, i));
      w = w.slice(i);
    }
    const test = cur ? `${cur} ${w}` : w;
    if (cur && f.widthOfTextAtSize(test, size) > maxWidth) {
      push();
      cur = w;
    } else {
      cur = test;
    }
  }
  push();
  return out.length ? out : [""];
}

export async function buildConfirmationPdf(data: {
  title: string;
  applicant: string;
  eingang: Date;
  statusLink: string;
  number?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 56;
  const maxWidth = 595.28 - left - 40; // rechter Rand
  let y = 780;

  // Bricht Text auf die Seitenbreite um, damit lange Antragsgegenstände/
  // Antragsteller/Status-Links nicht aus der A4-Seite herauslaufen.
  const wrap = (s: string, f: PDFFont, size: number): string[] =>
    wrapText(s, f, size, maxWidth);

  const line = (
    text: string,
    opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {},
  ) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const color = opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1);
    const lines = wrap(winAnsiSafe(text), f, size);
    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], { x: left, y, size, font: f, color });
      y -= size + (i < lines.length - 1 ? 2 : (opts.gap ?? 8));
    }
  };

  const eingang = formatDateTime(data.eingang, "long");

  line("Eingangsbestätigung", { size: 22, bold: true, gap: 6 });
  // Untertitel — hier ggf. den eigenen Gremien-/Organisationsnamen eintragen.
  line("Antragsverwaltung", {
    size: 11,
    color: [0.4, 0.4, 0.4],
    gap: 24,
  });

  if (data.number) {
    line("Antragsnummer", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
    line(data.number, { size: 13, bold: true, gap: 16 });
  }

  line("Antragsgegenstand", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.title, { size: 13, gap: 16 });

  line("Antragsteller", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.applicant, { size: 13, gap: 16 });

  line("Eingangsdatum", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(eingang, { size: 13, gap: 24 });

  line("Status-Link", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.statusLink, { size: 11, color: [0.15, 0.3, 0.7], gap: 24 });

  line("Bitte speichere diesen Link.", { size: 12, bold: true, gap: 4 });
  line("Über ihn kannst du jederzeit den aktuellen Status deines Antrags abrufen.", {
    size: 11,
    color: [0.4, 0.4, 0.4],
  });

  return doc.save();
}

/**
 * Eingangsbestätigung für FEEDBACK.
 *
 * Anders als die Antragsbestätigung mehrseitig: Der Feedbacktext darf bis zu
 * 10.000 Zeichen lang sein. Der Schreiber unten legt bei Bedarf automatisch eine
 * neue Seite an, respektiert Absätze (`\n`) und bricht auch überlange Wörter
 * bzw. URLs sauber um. Nicht darstellbare Zeichen (Emoji, nicht-lateinische
 * Schriften) fängt `winAnsiSafe` ab — sonst würde pdf-lib werfen und der Abruf
 * 500 liefern.
 */
export async function buildFeedbackConfirmationPdf(data: {
  areaName: string;
  submitterName: string;
  feedbackText: string;
  eingang: Date;
  statusLink: string;
  number?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE: [number, number] = [595.28, 841.89]; // A4
  const left = 56;
  const top = 780;
  const bottom = 60; // unterhalb davon wird umgebrochen
  const maxWidth = PAGE[0] - left - 40;

  let page = doc.addPage(PAGE);
  let y = top;

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = top;
  };

  const line = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      gap?: number;
      color?: [number, number, number];
    } = {},
  ) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const color = opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1);
    // Absätze einzeln umbrechen, damit Leerzeilen erhalten bleiben. Dieser
    // Builder teilt selbst an \n auf, darf die Umbrüche also behalten.
    const paragraphs = winAnsiSafe(text, { keepNewlines: true }).split("\n");
    for (let p = 0; p < paragraphs.length; p++) {
      const lines = paragraphs[p] === "" ? [""] : wrapText(paragraphs[p], f, size, maxWidth);
      for (let i = 0; i < lines.length; i++) {
        if (y - size < bottom) newPage();
        page.drawText(lines[i], { x: left, y, size, font: f, color });
        const isLast = p === paragraphs.length - 1 && i === lines.length - 1;
        y -= size + (isLast ? (opts.gap ?? 8) : 2);
      }
    }
  };

  line("Eingangsbestätigung", { size: 22, bold: true, gap: 6 });
  line("Feedback", { size: 11, color: [0.4, 0.4, 0.4], gap: 24 });

  if (data.number) {
    line("Nummer", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
    line(data.number, { size: 13, bold: true, gap: 16 });
  }

  line("Bereich", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.areaName, { size: 13, gap: 16 });

  line("Einreicher", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.submitterName, { size: 13, gap: 16 });

  line("Eingangsdatum", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(formatDateTime(data.eingang, "long"), { size: 13, gap: 24 });

  line("Dein Feedback", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 6 });
  line(data.feedbackText, { size: 11, gap: 24 });

  line("Status-Link", { size: 9, bold: true, color: [0.4, 0.4, 0.4], gap: 2 });
  line(data.statusLink, { size: 11, color: [0.15, 0.3, 0.7], gap: 24 });

  line("Bitte speichere diesen Link.", { size: 12, bold: true, gap: 4 });
  line("Über ihn kannst du jederzeit den aktuellen Status deines Feedbacks abrufen.", {
    size: 11,
    color: [0.4, 0.4, 0.4],
  });

  return doc.save();
}
