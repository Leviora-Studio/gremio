// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import {
  degrees,
  PDFBool,
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { locatePdfWidgets, syncLegacyWidgetAppearances } from "@/lib/pdf-widget-compat";

// Markierung an „unseren" Freitextfeldern, damit sie sich von echten
// Formularfeldern unterscheiden lassen (nur diese sind frei verschieb-/skalierbar).
const GREMIO_TEXT_KEY = "GremioFreeText";

// Some old producers omit the Radio flag on a single-value button group.
// Distinct widget On states distinguish it from repeated views of one checkbox.
function isLegacyRadioGroup(field: PDFField): boolean {
  if (!(field instanceof PDFCheckBox)) return false;
  try { return radioOnOptions(field).length > 1; } catch { return false; }
}

/** Trägt ein Feld unsere Freitext-Markierung? Nur solche dürfen verschoben/überschrieben werden. */
function isGremioText(field: PDFField): boolean {
  try {
    return field.acroField.dict.has(PDFName.of(GREMIO_TEXT_KEY));
  } catch {
    return false;
  }
}

// ── Seitengeometrie: MediaBox-Ursprung + Seitenrotation berücksichtigen ───────
// Der Browser (pdf.js) rendert Seiten bereits ROTIERT, mit Ursprung oben-links
// der sichtbaren Fläche; Ratios vom Client beziehen sich also auf die SICHTBARE
// Seite. PDF-Nutzerkoordinaten haben dagegen ihren Ursprung unten-links der
// unrotierten MediaBox (ggf. mit Offset). Diese Helfer rechnen exakt zwischen
// beiden Welten um — bei rot=0 und Ursprung (0,0) sind sie die Identität.
type PageGeom = {
  ox: number;
  oy: number;
  mw: number;
  mh: number;
  rot: 0 | 90 | 180 | 270;
  vw: number; // sichtbare Breite (rotiert)
  vh: number; // sichtbare Höhe (rotiert)
};

function pageGeom(page: PDFPage): PageGeom {
  const mb = page.getMediaBox();
  const raw = page.getRotation().angle || 0;
  const rot = (((((Math.round(raw / 90) * 90) % 360) + 360) % 360) || 0) as
    | 0
    | 90
    | 180
    | 270;
  const swap = rot === 90 || rot === 270;
  return {
    ox: mb.x,
    oy: mb.y,
    mw: mb.width,
    mh: mb.height,
    rot,
    vw: swap ? mb.height : mb.width,
    vh: swap ? mb.width : mb.height,
  };
}

/** Unrotiert-normiert (u: links→rechts, v: unten→oben) → sichtbar-normiert (links/oben). */
function toView(u: number, v: number, rot: number): { rx: number; ry: number } {
  switch (rot) {
    case 90:
      return { rx: v, ry: u };
    case 180:
      return { rx: 1 - u, ry: v };
    case 270:
      return { rx: 1 - v, ry: 1 - u };
    default:
      return { rx: u, ry: 1 - v };
  }
}

/** Sichtbar-normiert (links/oben) → unrotiert-normiert (u/v). */
function fromView(rx: number, ry: number, rot: number): { u: number; v: number } {
  switch (rot) {
    case 90:
      return { u: ry, v: rx };
    case 180:
      return { u: 1 - rx, v: ry };
    case 270:
      return { u: 1 - ry, v: 1 - rx };
    default:
      return { u: rx, v: 1 - ry };
  }
}

/** PDF-Widget-Rechteck (Nutzerkoordinaten, absolut) → sichtbare Ratios (links/oben). */
function rectPdfToView(
  g: PageGeom,
  r: { x: number; y: number; width: number; height: number },
): FieldRect {
  const a = toView((r.x - g.ox) / g.mw, (r.y - g.oy) / g.mh, g.rot);
  const b = toView(
    (r.x + r.width - g.ox) / g.mw,
    (r.y + r.height - g.oy) / g.mh,
    g.rot,
  );
  return {
    xRatio: Math.min(a.rx, b.rx),
    yRatio: Math.min(a.ry, b.ry),
    wRatio: Math.abs(a.rx - b.rx),
    hRatio: Math.abs(a.ry - b.ry),
  };
}

/** Sichtbarer Punkt (in Punkten, oben-links) → PDF-Nutzerkoordinaten (absolut). */
function pointViewToPdf(
  g: PageGeom,
  vpx: number,
  vpy: number,
): { x: number; y: number } {
  const { u, v } = fromView(vpx / g.vw, vpy / g.vh, g.rot);
  return { x: g.ox + u * g.mw, y: g.oy + v * g.mh };
}

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
export async function applyPdfEdits(
  pdf: Buffer,
  edits: PdfEdits,
): Promise<{ pdf: Buffer; failed: string[] }> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const form = doc.getForm();
  // pdf-lib returns fresh PDFField wrappers; their underlying dictionaries are stable.
  const widgetLocations = new Map([...locatePdfWidgets(doc, form.getFields())].map(([field, widgets]) => [field.acroField.dict, widgets]));
  const changedFields = new Set<PDFField>();
  // Felder, die NICHT gesetzt werden konnten — der Aufrufer meldet sie statt sie
  // still zu verschlucken (sonst „gespeichert" trotz Datenverlust).
  const failed: string[] = [];

  if (edits.fields?.length) {
    for (const fe of edits.fields) {
      let field;
      try {
        field = form.getField(fe.name);
      } catch {
        console.warn("[pdf-edit] Feld nicht gefunden:", fe.name);
        failed.push(fe.name);
        continue;
      }
      if (field.isReadOnly()) {
        // Schreibgeschützte Felder serverseitig NICHT überschreiben (die UI blendet
        // sie ohnehin aus) — sonst täte das RPC mehr als die Oberfläche zulässt.
        console.warn("[pdf-edit] Schreibgeschütztes Feld übersprungen:", fe.name);
        continue;
      }
      try {
        if (isLegacyRadioGroup(field)) {
          // Only explicit editing repairs the missing flag; opening is read-only.
          field.acroField.setFlags(field.acroField.getFlags() | (1 << 15));
          field = form.getField(fe.name);
        }
        if (field instanceof PDFTextField) {
          // Mehrzeilen-Felder mit Auto-/absurd großer Schrift auf eine
          // vernünftige feste Größe setzen — sonst bäckt pdf-lib beim Speichern
          // eine riesige Größe ein (Fließtext-Felder sind dann unbrauchbar groß).
          try {
            if (field.isMultiline()) {
              const da = field.acroField.getDefaultAppearance() ?? "";
              const mm = /(\d+(?:\.\d+)?)\s+Tf/.exec(da);
              const cur = mm ? parseFloat(mm[1]) : 0;
              if (cur === 0 || cur > 14) field.setFontSize(11);
            }
          } catch {
            /* ignore */
          }
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
        changedFields.add(field);
      } catch (e) {
        console.warn(
          "[pdf-edit] Feld konnte nicht gesetzt werden:",
          fe.name,
          JSON.stringify(fe.value),
          e instanceof Error ? e.message : e,
        );
        failed.push(fe.name);
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
      const g = pageGeom(page);
      const size = Math.max(6, Math.min(64, (t.sizeRatio ?? 0.02) * g.vh));
      const value = sanitizeWinAnsi(t.text ?? "");
      const multiline = value.includes("\n");
      // Box-Maße in SICHTBAREN Punkten ableiten, dann ins (ggf. rotierte/
      // versetzte) PDF-Koordinatensystem abbilden.
      const { boxW, boxH } = deriveBox(value, size, g.vw);
      const vx = Math.max(0, Math.min(g.vw - 12, t.xRatio * g.vw));
      const vy = Math.max(0, Math.min(Math.max(0, g.vh - boxH), t.yRatio * g.vh));
      const c1 = pointViewToPdf(g, vx, vy);
      const c2 = pointViewToPdf(g, vx + boxW, vy + boxH);
      const rect = {
        x: Math.min(c1.x, c2.x),
        y: Math.min(c1.y, c2.y),
        width: Math.abs(c1.x - c2.x),
        height: Math.abs(c1.y - c2.y),
      };

      const existing = t.name ? byName.get(t.name) : undefined;
      if (existing) {
        // Nur EIGENE Freitextfelder (mit Marker) dürfen verschoben/überschrieben
        // werden — ein manipuliertes `name` darf kein echtes Formularfeld kapern.
        if (!(existing instanceof PDFTextField) || !isGremioText(existing)) {
          console.warn(
            "[pdf-edit] Freitext-Update auf fremdes Feld ignoriert:",
            t.name,
          );
          continue;
        }
        if (multiline) existing.enableMultiline();
        const widget = existing.acroField.getWidgets()[0];
        if (widget) widget.setRectangle(rect);
        existing.setFontSize(size);
        existing.setText(value);
        existing.updateAppearances(font);
      } else {
        if (!value.trim()) continue; // keine leeren Felder neu anlegen
        const tf = form.createTextField(nextName());
        if (multiline) tf.enableMultiline();
        // addToPage zuerst — danach existiert die /DA-Angabe (für setFontSize nötig).
        // Auf rotierten Seiten das Widget mitdrehen (bei rot=0 ein No-op), damit
        // der Text aufrecht erscheint.
        tf.addToPage(page, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          font,
          borderWidth: 0,
          rotate: degrees(g.rot),
        });
        tf.setFontSize(size);
        tf.setText(value);
        tf.acroField.dict.set(PDFName.of(GREMIO_TEXT_KEY), PDFBool.True);
        tf.updateAppearances(font);
      }
    }
  }

  if ([...changedFields].some(field => widgetLocations.get(field.acroField.dict)?.some(w => w.widget.dict !== w.source.dict))) {
    form.updateFieldAppearances();
    for (const field of changedFields) syncLegacyWidgetAppearances(field, widgetLocations.get(field.acroField.dict) ?? []);
  }
  return { pdf: Buffer.from(await doc.save()), failed };
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

  let fields: PDFField[];
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const locations = locatePdfWidgets(doc, fields);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function placement(field: any, multiline = false): Pick<FieldMeta, "page" | "rect" | "sizeRatio"> {
    try {
      const first = locations.get(field)?.[0];
      if (!first) return {};
      const { widget: w, page: pageIndex } = first;
      const g = pageGeom(pages[pageIndex]);
      const r = w.getRectangle();
      const rect = rectPdfToView(g, r);
      // Schriftgröße aus der DA-Angabe. Auto (0) ODER Mehrzeilen-Felder NICHT
      // aus der Feldhöhe ableiten (sonst riesig) — Fließtext bleibt klein (≤12).
      // pdf-lib bäckt bei Auto-Größe teils absurde Größen ins DA (z. B. 177 pt);
      // bei Mehrzeilen-Feldern wird daher generell auf ≤12 pt gedeckelt.
      const da: string | undefined = field.acroField.getDefaultAppearance?.();
      const m = da ? /(\d+(?:\.\d+)?)\s+Tf/.exec(da) : null;
      const fs = m ? parseFloat(m[1]) : 0;
      const pt = multiline
        ? Math.min(12, fs > 0 ? fs : 12)
        : fs > 0
          ? fs
          : Math.min(12, r.height * 0.7);
      return { page: pageIndex, rect, sizeRatio: pt / g.vh };
    } catch {
      return {};
    }
  }

  // Alle Widget-Rechtecke eines Feldes (für mehrfach platzierte Felder).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function widgetRects(field: any): NonNullable<FieldMeta["widgets"]> {
    const out: NonNullable<FieldMeta["widgets"]> = [];
    try {
      for (const { widget: w, page: pageIndex } of locations.get(field) ?? []) {
        const g = pageGeom(pages[pageIndex]);
        out.push({ page: pageIndex, rect: rectPdfToView(g, w.getRectangle()) });
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
      for (const { widget: w, page: pageIndex } of locations.get(field) ?? []) {
        const on = w.getOnValue?.();
        const value = on ? on.decodeText() : "";
        if (!value) continue;
        const g = pageGeom(pages[pageIndex]);
        out.push({
          value,
          page: pageIndex,
          rect: rectPdfToView(g, w.getRectangle()),
        });
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  const out: FieldMeta[] = [];
  for (const f of fields) {
    const name = f.getName();
    const readOnly = f.isReadOnly();
    if (f instanceof PDFSignature) continue; // Signaturfelder nicht ausfüllbar
    if (f instanceof PDFTextField) {
      // Ausschließlich am Marker erkennen — KEIN Namensmuster wie „Text 1", das
      // auch echte Formularfelder fälschlich als verschiebbaren Freitext einstufte.
      const gremioText = isGremioText(f);
      let multiline = false;
      try {
        multiline = f.isMultiline();
      } catch {
        /* ignore */
      }
      out.push({
        name,
        type: "text",
        value: f.getText() ?? "",
        readOnly,
        gremioText,
        ...placement(f, multiline),
        widgets: widgetRects(f),
      });
    } else if (isLegacyRadioGroup(f)) {
      out.push({ name, type: "radio", value: radioOnValue(f), options: radioOnOptions(f), readOnly, optionWidgets: radioWidgets(f) });
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
        widgets: widgetRects(f),
      });
    } else if (f instanceof PDFOptionList) {
      out.push({
        name,
        type: "optionlist",
        value: selectedDisplay(f),
        options: safeOptions(() => f.getOptions()),
        readOnly,
        ...placement(f),
        widgets: widgetRects(f),
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
  let resolved = true; // konnte der Wert einer Option zugeordnet werden?
  try {
    const raw = field.acroField.getOptions();
    const isDisplay = raw.some(
      (o) => (o.display ?? o.value).decodeText() === value,
    );
    if (!isDisplay) {
      const byExport = raw.find((o) => o.value.decodeText() === value);
      if (byExport) toSelect = (byExport.display ?? byExport.value).decodeText();
      else resolved = false;
    }
  } catch {
    /* Roh-Optionen nicht lesbar — Originalwert versuchen */
    resolved = true;
  }
  if (!resolved) {
    // Editierbares Combo-Feld darf beliebigen Freitext führen; sonst gehört der
    // Wert zu keiner Option → NICHT setzen (würde pdf-lib werfen / Editier-Flag
    // erzwingen). Als Fehlschlag weiterreichen, damit es gemeldet wird.
    if (field instanceof PDFDropdown && field.isEditable()) {
      field.select(value);
      return;
    }
    throw new Error(`Unbekannte Auswahl-Option: ${value}`);
  }
  field.select(toSelect);
}

/** Aktuell gewählter Radio-Wert = der On-State im /V (maßgeblich, /Opt egal). */
function radioOnValue(field: PDFField): string {
  try {
    const v = field.acroField.dict.lookup(PDFName.of("V"));
    return v instanceof PDFName ? v.decodeText() : "";
  } catch {
    return "";
  }
}

/** Radio-Optionen = die Widget-On-States (echte Werte, auch bei kaputtem /Opt). */
function radioOnOptions(field: PDFField): string[] {
  try {
    return [...new Set(field.acroField.getWidgets().flatMap(w => {
      const value = w.getOnValue();
      return value ? [value.decodeText()] : [];
    }))];
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
