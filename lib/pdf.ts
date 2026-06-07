// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatDateTime } from "@/lib/dates";

/**
 * Macht freien Nutzertext für die WinAnsi-Standardschrift sicher: häufige
 * Typografie-Zeichen auf ASCII abbilden, alles außerhalb von Latin-1
 * (Emoji, nicht-lateinische Schriften) durch "?" ersetzen — sonst wirft
 * pdf-lib "WinAnsi cannot encode …" und der PDF-Abruf liefert 500.
 */
function winAnsiSafe(s: string): string {
  const mapped = (s ?? "")
    .replace(/[‘’‚′´`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR");
  let out = "";
  for (const ch of mapped) {
    const c = ch.codePointAt(0) ?? 0;
    // Tab/LF/CR, druckbares ASCII (0x20–0x7E), Latin-1 (0xA0–0xFF: ä ö ü ß …).
    const ok =
      c === 9 ||
      c === 10 ||
      c === 13 ||
      (c >= 0x20 && c <= 0x7e) ||
      (c >= 0xa0 && c <= 0xff);
    out += ok ? ch : "?";
  }
  return out;
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

  // Bricht Text auf die Seitenbreite um (Wort- und notfalls Zeichen-Umbruch),
  // damit lange Antragsgegenstände/Antragsteller/Status-Links nicht aus der
  // A4-Seite herauslaufen.
  const wrap = (s: string, f: typeof font, size: number): string[] => {
    const out: string[] = [];
    let cur = "";
    const push = () => {
      if (cur) out.push(cur);
      cur = "";
    };
    for (const word of s.split(" ")) {
      let w = word;
      // Überlange „Wörter" (z. B. URLs) hart auf Zeichenebene brechen.
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
  };

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
