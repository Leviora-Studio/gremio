// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  PDFDocument,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
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
    .replace(/ /g, " ")
    .replace(/[^ -~ -ÿ€]/g, "?");
}

/**
 * Wendet Freitext + Formularfeld-Werte auf ein PDF an (serverseitig, pdf-lib).
 *
 * Freitext wird als ausfüllbares AcroForm-Textfeld angelegt (nicht fest ins PDF
 * gezeichnet), damit er nach dem Speichern WEITER editierbar bleibt. Bestehende
 * Felder (auch zuvor angelegte Texte) werden per Wert aktualisiert.
 */
export async function applyPdfEdits(pdf: Buffer, edits: PdfEdits): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const form = doc.getForm();

  if (edits.fields?.length) {
    for (const fe of edits.fields) {
      let field;
      try {
        field = form.getField(fe.name);
      } catch {
        continue; // Feld existiert nicht (mehr)
      }
      try {
        if (field instanceof PDFTextField) {
          // WinAnsi-sicher, sonst scheitert die Appearance-Erzeugung beim Speichern.
          field.setText(
            sanitizeWinAnsi(typeof fe.value === "string" ? fe.value : ""),
          );
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
    const used = new Set(form.getFields().map((f) => f.getName()));
    let counter = 1;
    const nextName = () => {
      let n: string;
      do {
        n = `Text ${counter++}`;
      } while (used.has(n));
      used.add(n);
      return n;
    };

    for (const t of edits.texts) {
      const page = pages[t.page];
      if (!page || !t.text?.trim()) continue;
      const { width, height } = page.getSize();
      const size = Math.max(6, Math.min(64, (t.sizeRatio ?? 0.02) * height));
      const value = sanitizeWinAnsi(t.text);
      const lines = value.split(/\r?\n/);
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const boxW = Math.min(width - 4, Math.max(40, maxLen * size * 0.55 + 10));
      const boxH = Math.max(size * 1.5, lines.length * size * 1.32 + 6);
      const x = Math.max(0, Math.min(width - 12, t.xRatio * width));
      const y = Math.max(0, height - t.yRatio * height - boxH);

      const tf = form.createTextField(nextName());
      if (lines.length > 1) tf.enableMultiline();
      // addToPage zuerst — danach existiert die /DA-Angabe (für setFontSize nötig).
      tf.addToPage(page, { x, y, width: boxW, height: boxH, font, borderWidth: 0 });
      tf.setFontSize(size);
      tf.setText(value);
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

export type FieldRect = {
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
};

export type FieldMeta = {
  name: string;
  type: FieldType;
  value: string | boolean | null;
  options?: string[];
  readOnly: boolean;
  // Für positionierte, in-place editierbare Darstellung (v. a. Textfelder):
  page?: number;
  rect?: FieldRect;
  sizeRatio?: number;
};

/** Liest die ausfüllbaren AcroForm-Felder eines PDFs (für den Editor). */
export async function readPdfFields(pdf: Buffer): Promise<FieldMeta[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  } catch {
    return [];
  }
  const pages = doc.getPages();

  // Widget-Dict → Seitenindex (zum Positionieren der Felder).
  const pageOfDict = new Map<PDFDict, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      try {
        pageOfDict.set(annots.lookup(k, PDFDict), i);
      } catch {
        /* ignore */
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function placement(field: any): Pick<FieldMeta, "page" | "rect" | "sizeRatio"> {
    try {
      const widgets = field.acroField.getWidgets();
      if (!widgets.length) return {};
      const w = widgets[0];
      const pageIndex = pageOfDict.get(w.dict);
      if (pageIndex == null) return {};
      const p = pages[pageIndex];
      const { width: pw, height: ph } = p.getSize();
      const r = w.getRectangle();
      const rect: FieldRect = {
        xRatio: r.x / pw,
        yRatio: (ph - (r.y + r.height)) / ph,
        wRatio: r.width / pw,
        hRatio: r.height / ph,
      };
      const da: string | undefined = field.acroField.getDefaultAppearance?.();
      const m = da ? /(\d+(?:\.\d+)?)\s+Tf/.exec(da) : null;
      const fs = m ? parseFloat(m[1]) : 0;
      const sizeRatio = fs > 0 ? fs / ph : Math.min(0.5, (r.height / ph) * 0.6);
      return { page: pageIndex, rect, sizeRatio };
    } catch {
      return {};
    }
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
      out.push({
        name,
        type: "text",
        value: f.getText() ?? "",
        readOnly,
        ...placement(f),
      });
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
