// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildXlsx } from "@/lib/xlsx";

export type Cell = string | number | null;
// section/total = Trenn-/Summenzeilen; top = Oberpunkt (Block-Kopf),
// sub = Unterpunkt (im Block). top+sub bilden im PDF eine Box.
export type RowStyle = "section" | "total" | "top" | "sub";
/** Eine Zeile: entweder nur Zellen oder Zellen + Stil. */
export type Row = Cell[] | { cells: Cell[]; style?: RowStyle };

export type Column = {
  header: string;
  /** Relatives Breitengewicht (PDF) bzw. abgeleitete Spaltenbreite (Excel). */
  width?: number;
  money?: boolean;
};

export type Table = {
  title: string;
  subtitle?: string;
  columns: Column[];
  /** Zellen: string | number | null. Money-Spalten als Zahl (in EURO). */
  rows: Row[];
};

function normRow(r: Row): { cells: Cell[]; style?: RowStyle } {
  return Array.isArray(r) ? { cells: r } : r;
}

// --- Excel (.xlsx) ----------------------------------------------------------
export async function tablesToXlsx(tables: Table[]): Promise<Uint8Array> {
  return buildXlsx(
    tables.map((t) => ({
      name: t.title,
      columns: t.columns.map((c) => ({
        header: c.header,
        money: c.money,
        // Relatives Gewicht → Excel-Zeichenbreite.
        width: c.width != null ? Math.round(c.width * 9) : undefined,
      })),
      rows: t.rows.map((r) => normRow(r)),
    })),
  );
}

// --- PDF --------------------------------------------------------------------
function pdfSafe(s: string): string {
  return (
    s
      .replace(/[\u2018\u2019\u201A]/g, "'")
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      // Helvetica/WinAnsi: druckbares Latin-1 + Euro behalten, Rest -> "?".
      .replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC]/g, "?")
  );
}

function money(v: number): string {
  return v.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fit(
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  maxWidth: number,
): string {
  let t = pdfSafe(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

export async function tablesToPdf(
  docTitle: string,
  tables: Table[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const H = 595;
  const M = 36;
  const size = 9;
  const lineH = 16;
  const sectionFill = rgb(0.85, 0.882, 0.949); // D9E1F2 (Einnahmen/Ausgaben)
  const topFill = rgb(0.93, 0.95, 0.985); // hellerer Block-Kopf (Oberpunkt)
  const boxBorder = rgb(0.62, 0.66, 0.74);
  const rowTop = (yb: number) => yb + (lineH - 4);
  const rowBottom = (yb: number) => yb - 4;

  for (const t of tables) {
    const totalW = t.columns.reduce((s, c) => s + (c.width ?? 1), 0);
    // Seitenbreite an die Spalten anpassen: breite Tabellen (viele Spalten)
    // bekommen eine breitere Seite, damit KEINE Spalte abgeschnitten wird.
    // Schmale Tabellen bleiben bei A4-quer (842 pt); ein Mindest-Platz pro
    // Gewichtseinheit hält jede Spalte lesbar.
    const PT_PER_UNIT = 50;
    const W = Math.max(842, Math.round(totalW * PT_PER_UNIT) + 2 * M);
    const colW = t.columns.map((c) => ((c.width ?? 1) / totalW) * (W - 2 * M));
    const colX: number[] = [];
    let acc = M;
    for (const w of colW) {
      colX.push(acc);
      acc += w;
    }

    let page = doc.addPage([W, H]);
    let y = H - M;
    page.drawText(pdfSafe(t.title), { x: M, y, size: 14, font: bold });
    y -= 18;
    if (t.subtitle) {
      page.drawText(pdfSafe(t.subtitle), {
        x: M,
        y,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 14;
    }
    y -= 6;

    const drawHeader = () => {
      t.columns.forEach((c, i) => {
        const tx = fit(c.header, bold, size, colW[i] - 4);
        const x = c.money
          ? colX[i] + colW[i] - 4 - bold.widthOfTextAtSize(tx, size)
          : colX[i];
        page.drawText(tx, { x, y, size, font: bold });
      });
      y -= 4;
      page.drawLine({
        start: { x: M, y },
        end: { x: W - M, y },
        thickness: 0.7,
        color: rgb(0.5, 0.5, 0.5),
      });
      y -= lineH - 4;
    };
    drawHeader();

    // Box-Status: top eröffnet eine Box, sub-Zeilen gehören dazu, jede andere
    // Zeile (section/total/normal) bzw. die nächste top-Zeile schließt sie.
    let boxOpen = false;
    let boxTop = 0;
    let lastBottom = rowBottom(y);
    const closeBox = () => {
      if (!boxOpen) return;
      page.drawRectangle({
        x: M - 1,
        y: lastBottom,
        width: W - 2 * M + 2,
        height: boxTop - lastBottom,
        borderColor: boxBorder,
        borderWidth: 0.8,
      });
      boxOpen = false;
    };

    for (const raw of t.rows) {
      const { cells, style } = normRow(raw);
      if (y < M + lineH) {
        closeBox();
        page = doc.addPage([W, H]);
        y = H - M;
        drawHeader();
      }

      if (style === "top") {
        closeBox();
        boxOpen = true;
        boxTop = rowTop(y);
        // Block-Kopf hinterlegen.
        page.drawRectangle({
          x: M - 1,
          y: rowBottom(y),
          width: W - 2 * M + 2,
          height: lineH,
          color: topFill,
        });
      } else if (style !== "sub") {
        closeBox();
      }

      const f = style === "sub" || style == null ? font : bold;

      if (style === "section") {
        page.drawRectangle({
          x: M,
          y: y - 4,
          width: W - 2 * M,
          height: lineH,
          color: sectionFill,
        });
      }
      if (style === "total") {
        page.drawLine({
          start: { x: M, y: y + lineH - 5 },
          end: { x: W - M, y: y + lineH - 5 },
          thickness: 0.7,
          color: rgb(0.4, 0.4, 0.4),
        });
      }

      t.columns.forEach((c, i) => {
        const v = cells[i];
        const str =
          v == null ? "" : c.money && typeof v === "number" ? money(v) : String(v);
        if (str === "") return;
        const tx = fit(str, f, size, colW[i] - 4);
        const x = c.money
          ? colX[i] + colW[i] - 4 - f.widthOfTextAtSize(tx, size)
          : colX[i];
        page.drawText(tx, { x, y, size, font: f });
      });

      lastBottom = rowBottom(y);
      y -= lineH;
    }
    closeBox();
  }

  return doc.save();
}
