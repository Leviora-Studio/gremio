// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  PDFBool,
  PDFDocument,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";

// Markierung an „unseren" Freitextfeldern, damit sie sich von echten
// Formularfeldern unterscheiden lassen (nur diese sind frei verschieb-/skalierbar).
const GREMIO_TEXT_KEY = "GremioFreeText";

// Freitext: Position als Anteil der Seitenmaße von OBEN-LINKS (wie der
// Canvas-Overlay im Browser), Schriftgröße als Anteil der Seitenhöhe.
// name gesetzt = bestehendes Freitextfeld aktualisieren; sonst neu anlegen.
export type TextEdit = {
  name?: string;
  page: number;
  xRatio: number;
  yRatio: number;
  text: string;
  sizeRatio?: number;
};

/** Box-Maße eines Freitextfelds aus Inhalt + Schriftgröße ableiten (Client & Server gleich). */
function deriveBox(value: string, size: number, pageWidth: number) {
  const lines = value.split(/\r?\n/);
  const maxLen = Math.max(1, ...lines.map((l) => l.length));
  const boxW = Math.min(pageWidth - 4, Math.max(40, maxLen * size * 0.55 + 10));
  const boxH = Math.max(size * 1.5, lines.length * size * 1.32 + 6);
  return { boxW, boxH };
}

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
        console.warn("[pdf-edit] Feld nicht gefunden:", fe.name);
        continue;
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
          field instanceof PDFOptionList
        ) {
          if (typeof fe.value === "string" && fe.value) {
            selectChoice(field, fe.value);
          } else {
            field.clear();
          }
        } else if (field instanceof PDFRadioGroup) {
          if (typeof fe.value === "string" && fe.value) {
            selectRadio(field, fe.value);
          } else {
            field.clear();
          }
        }
      } catch (e) {
        console.warn(
          "[pdf-edit] Feld konnte nicht gesetzt werden:",
          fe.name,
          JSON.stringify(fe.value),
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  if (edits.texts?.length) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const byName = new Map(form.getFields().map((f) => [f.getName(), f]));
    const used = new Set(byName.keys());
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
      if (!page) continue;
      const { width, height } = page.getSize();
      const size = Math.max(6, Math.min(64, (t.sizeRatio ?? 0.02) * height));
      const value = sanitizeWinAnsi(t.text ?? "");
      const multiline = value.includes("\n");
      const { boxW, boxH } = deriveBox(value, size, width);
      const x = Math.max(0, Math.min(width - 12, t.xRatio * width));
      const y = Math.max(0, height - t.yRatio * height - boxH);

      const existing = t.name ? byName.get(t.name) : undefined;
      if (existing instanceof PDFTextField) {
        // Bestehendes Freitextfeld: Wert, Größe UND Position aktualisieren.
        if (multiline) existing.enableMultiline();
        const widget = existing.acroField.getWidgets()[0];
        if (widget) widget.setRectangle({ x, y, width: boxW, height: boxH });
        existing.setFontSize(size);
        existing.setText(value);
        existing.updateAppearances(font);
      } else {
        if (!value.trim()) continue; // keine leeren Felder neu anlegen
        const tf = form.createTextField(nextName());
        if (multiline) tf.enableMultiline();
        // addToPage zuerst — danach existiert die /DA-Angabe (für setFontSize nötig).
        tf.addToPage(page, { x, y, width: boxW, height: boxH, font, borderWidth: 0 });
        tf.setFontSize(size);
        tf.setText(value);
        tf.acroField.dict.set(PDFName.of(GREMIO_TEXT_KEY), PDFBool.True);
        tf.updateAppearances(font);
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
  // true = von uns angelegter Freitext (frei verschieb-/skalierbar).
  gremioText?: boolean;
  // Radio-Buttons: pro Option ein Widget (eigene Seite/Position + Export-Wert).
  optionWidgets?: { value: string; page: number; rect: FieldRect }[];
  // Alle Widgets eines Feldes (Text/Checkbox können MEHRERE haben, z. B. zwei
  // synchronisierte „Antragsnummer"-Felder). Alle teilen denselben Wert.
  widgets?: { page: number; rect: FieldRect }[];
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

  // Alle Widget-Rechtecke eines Feldes (für mehrfach platzierte Felder).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function widgetRects(field: any): NonNullable<FieldMeta["widgets"]> {
    const out: NonNullable<FieldMeta["widgets"]> = [];
    try {
      for (const w of field.acroField.getWidgets()) {
        const pageIndex = pageOfDict.get(w.dict);
        if (pageIndex == null) continue;
        const p = pages[pageIndex];
        const { width: pw, height: ph } = p.getSize();
        const r = w.getRectangle();
        out.push({
          page: pageIndex,
          rect: {
            xRatio: r.x / pw,
            yRatio: (ph - (r.y + r.height)) / ph,
            wRatio: r.width / pw,
            hRatio: r.height / ph,
          },
        });
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  // Radio-Buttons: pro Options-Widget eigene Position + der Widget-On-State als
  // Wert (maßgeblich, auch wenn /Opt kaputt/uneindeutig ist).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function radioWidgets(field: any): NonNullable<FieldMeta["optionWidgets"]> {
    const out: NonNullable<FieldMeta["optionWidgets"]> = [];
    try {
      for (const w of field.acroField.getWidgets()) {
        const pageIndex = pageOfDict.get(w.dict);
        if (pageIndex == null) continue;
        const p = pages[pageIndex];
        const { width: pw, height: ph } = p.getSize();
        const r = w.getRectangle();
        const on = w.getOnValue?.();
        const value = on ? on.decodeText() : "";
        if (!value) continue;
        out.push({
          value,
          page: pageIndex,
          rect: {
            xRatio: r.x / pw,
            yRatio: (ph - (r.y + r.height)) / ph,
            wRatio: r.width / pw,
            hRatio: r.height / ph,
          },
        });
      }
    } catch {
      /* ignore */
    }
    return out;
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
      let gremioText = /^Text \d+$/.test(name);
      try {
        if (f.acroField.dict.has(PDFName.of(GREMIO_TEXT_KEY))) gremioText = true;
      } catch {
        /* ignore */
      }
      out.push({
        name,
        type: "text",
        value: f.getText() ?? "",
        readOnly,
        gremioText,
        ...placement(f),
        widgets: widgetRects(f),
      });
    } else if (f instanceof PDFCheckBox) {
      out.push({
        name,
        type: "checkbox",
        value: f.isChecked(),
        readOnly,
        ...placement(f),
        widgets: widgetRects(f),
      });
    } else if (f instanceof PDFDropdown) {
      out.push({
        name,
        type: "dropdown",
        value: selectedDisplay(f),
        options: safeOptions(() => f.getOptions()),
        readOnly,
        ...placement(f),
      });
    } else if (f instanceof PDFOptionList) {
      out.push({
        name,
        type: "optionlist",
        value: selectedDisplay(f),
        options: safeOptions(() => f.getOptions()),
        readOnly,
        ...placement(f),
      });
    } else if (f instanceof PDFRadioGroup) {
      out.push({
        name,
        type: "radio",
        value: radioOnValue(f),
        options: radioOnOptions(f),
        readOnly,
        optionWidgets: radioWidgets(f),
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

/**
 * Auswahl-Wert robust setzen: getOptions() liefert Anzeige-Texte, getSelected()
 * aber Export-Werte. Kommt der Wert als Export-Wert rein (z. B. „A" statt
 * „Standort A"), wird er auf den passenden Anzeige-Text abgebildet, den pdf-lib
 * bei .select() erwartet (sonst InvalidAcroFieldValueError bei Combo-Feldern).
 */
function selectChoice(field: PDFDropdown | PDFOptionList, value: string): void {
  let toSelect = value;
  try {
    const raw = field.acroField.getOptions();
    const isDisplay = raw.some(
      (o) => (o.display ?? o.value).decodeText() === value,
    );
    if (!isDisplay) {
      const byExport = raw.find((o) => o.value.decodeText() === value);
      if (byExport) toSelect = (byExport.display ?? byExport.value).decodeText();
    }
  } catch {
    /* Roh-Optionen nicht lesbar — Originalwert versuchen */
  }
  field.select(toSelect);
}

/** Aktuell gewählter Radio-Wert = der On-State im /V (maßgeblich, /Opt egal). */
function radioOnValue(field: PDFRadioGroup): string {
  try {
    const v = field.acroField.dict.lookup(PDFName.of("V"));
    return v instanceof PDFName ? v.decodeText() : "";
  } catch {
    return "";
  }
}

/** Radio-Optionen = die Widget-On-States (echte Werte, auch bei kaputtem /Opt). */
function radioOnOptions(field: PDFRadioGroup): string[] {
  try {
    return field.acroField.getOnValues().map((n) => n.decodeText());
  } catch {
    return [];
  }
}

/**
 * Radio robust setzen: pdf-lib .select() prüft gegen /Opt (kann kaputt/uneindeutig
 * sein → wirft). Wir setzen direkt den Widget-On-State im /V. Fallbacks: Export-
 * Wert aus /Opt per Index, sonst doch .select().
 */
function selectRadio(field: PDFRadioGroup, value: string): void {
  const acro = field.acroField;
  const onValues = acro.getOnValues();
  const direct = onValues.find((n) => n.decodeText() === value);
  if (direct) {
    acro.setValue(direct);
    return;
  }
  try {
    const ev = acro.getExportValues?.();
    if (ev) {
      const idx = ev.findIndex((s) => s.decodeText() === value);
      if (idx >= 0 && onValues[idx]) {
        acro.setValue(onValues[idx]);
        return;
      }
    }
  } catch {
    /* ignore */
  }
  field.select(value);
}

/** Anzeige-Text der aktuellen Auswahl (damit er zu getOptions() passt). */
function selectedDisplay(field: PDFDropdown | PDFOptionList): string {
  try {
    const sel = field.getSelected()[0];
    if (!sel) return "";
    const raw = field.acroField.getOptions();
    const byExport = raw.find((o) => o.value.decodeText() === sel);
    return byExport ? (byExport.display ?? byExport.value).decodeText() : sel;
  } catch {
    try {
      return field.getSelected()[0] ?? "";
    } catch {
      return "";
    }
  }
}
