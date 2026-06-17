// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  rgb,
} from "pdf-lib";

// Freitext: Position als Anteil der Seitenmaße von OBEN-LINKS (wie der
// Canvas-Overlay im Browser), Schriftgröße als Anteil der Seitenhöhe.
export type TextEdit = {
  page: number;
  xRatio: number;
  yRatio: number;
  text: string;
  sizeRatio?: number;
};

export type FieldEdit = { name: string; value: string | boolean };
export type PdfEdits = { texts?: TextEdit[]; fields?: FieldEdit[] };

/** Helvetica = WinAnsi/Latin-1: nicht darstellbare Zeichen → "?". */
export function sanitizeWinAnsi(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^ -~ -ÿ€]/g, "?");
}

/**
 * Wendet Freitext + Formularfeld-Werte auf ein PDF an (serverseitig, pdf-lib)
 * und gibt die neuen Bytes zurück. Unbekannte Felder werden übersprungen.
 */
export async function applyPdfEdits(pdf: Buffer, edits: PdfEdits): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });

  if (edits.fields?.length) {
    const form = doc.getForm();
    for (const fe of edits.fields) {
      let field;
      try {
        field = form.getField(fe.name);
      } catch {
        continue; // Feld existiert nicht (mehr)
      }
      try {
        if (field instanceof PDFTextField) {
          field.setText(typeof fe.value === "string" ? fe.value : "");
        } else if (field instanceof PDFCheckBox) {
          if (fe.value) field.check();
          else field.uncheck();
        } else if (
          field instanceof PDFDropdown ||
          field instanceof PDFOptionList ||
          field instanceof PDFRadioGroup
        ) {
          if (typeof fe.value === "string" && fe.value) field.select(fe.value);
        }
      } catch {
        // ungültiger Wert (z. B. Option nicht vorhanden) — überspringen
      }
    }
  }

  if (edits.texts?.length) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    for (const t of edits.texts) {
      const page = pages[t.page];
      if (!page || !t.text?.trim()) continue;
      const { width, height } = page.getSize();
      const size = Math.max(6, Math.min(64, (t.sizeRatio ?? 0.02) * height));
      const x = t.xRatio * width;
      let y = height - t.yRatio * height - size; // oben-links → PDF-Baseline
      for (const line of sanitizeWinAnsi(t.text).split(/\r?\n/)) {
        page.drawText(line, { x, y, size, font, color: rgb(0.07, 0.07, 0.07) });
        y -= size * 1.25;
      }
    }
  }

  return Buffer.from(await doc.save());
}

export type FieldType =
  | "text"
  | "checkbox"
  | "dropdown"
  | "optionlist"
  | "radio"
  | "other";

export type FieldMeta = {
  name: string;
  type: FieldType;
  value: string | boolean | null;
  options?: string[];
  readOnly: boolean;
};

/** Liest die ausfüllbaren AcroForm-Felder eines PDFs (für das Editor-Seitenpanel). */
export async function readPdfFields(pdf: Buffer): Promise<FieldMeta[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  } catch {
    return [];
  }
  const out: FieldMeta[] = [];
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return [];
  }
  for (const f of fields) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFSignature) continue; // Signaturfelder nicht ausfüllbar
    if (f instanceof PDFTextField) {
      out.push({ name, type: "text", value: f.getText() ?? "", readOnly });
    } else if (f instanceof PDFCheckBox) {
      out.push({ name, type: "checkbox", value: f.isChecked(), readOnly });
    } else if (f instanceof PDFDropdown) {
      out.push({
        name,
        type: "dropdown",
        value: f.getSelected()[0] ?? "",
        options: safeOptions(() => f.getOptions()),
        readOnly,
      });
    } else if (f instanceof PDFOptionList) {
      out.push({
        name,
        type: "optionlist",
        value: f.getSelected()[0] ?? "",
        options: safeOptions(() => f.getOptions()),
        readOnly,
      });
    } else if (f instanceof PDFRadioGroup) {
      out.push({
        name,
        type: "radio",
        value: f.getSelected() ?? "",
        options: safeOptions(() => f.getOptions()),
        readOnly,
      });
    } else {
      out.push({ name, type: "other", value: null, readOnly });
    }
  }
  return out;
}

function safeOptions(fn: () => string[]): string[] {
  try {
    return fn();
  } catch {
    return [];
  }
}
