// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { PDFDict, PDFDocument, PDFField, PDFHexString, PDFName, PDFString, PDFWidgetAnnotation } from "pdf-lib";

export type LocatedPdfWidget = {
  page: number;
  widget: PDFWidgetAnnotation;
  source: PDFWidgetAnnotation;
};

function parents(dict: PDFDict): PDFDict[] {
  const chain: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  let current: PDFDict | undefined = dict;
  while (current && !seen.has(current) && chain.length < 64) {
    seen.add(current); chain.push(current);
    current = current.lookupMaybe(PDFName.of("Parent"), PDFDict);
  }
  return chain;
}

function fieldName(dict: PDFDict): string {
  return parents(dict).reverse().flatMap(node => {
    const name = node.lookup(PDFName.of("T"));
    return name instanceof PDFString || name instanceof PDFHexString ? [name.decodeText()] : [];
  }).join(".");
}

function inherited(dict: PDFDict, key: string) {
  for (const node of parents(dict)) {
    const value = node.lookup(PDFName.of(key));
    if (value) return value;
  }
}

function valueKey(dict: PDFDict, key: string) {
  const value = inherited(dict, key);
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : value?.toString() ?? "";
}

/** Resolve the page annotations without rewriting the document or its signatures.
 * Legacy forms may have separate copies in AcroForm/Fields and page Annots.
 * Never match by rectangle alone: unrelated/ambiguous fields stay in the panel.
 */
export function locatePdfWidgets(doc: PDFDocument, fields: PDFField[]): Map<PDFField, LocatedPdfWidget[]> {
  const result = new Map<PDFField, LocatedPdfWidget[]>();
  const pageWidgets: { page: number; widget: PDFWidgetAnnotation }[] = [];
  const direct = new Map<PDFDict, number>();
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      try {
        const dict = annots!.lookup(i, PDFDict);
        if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) continue;
        direct.set(dict, index);
        pageWidgets.push({ page: index, widget: PDFWidgetAnnotation.fromDict(dict) });
      } catch { /* One malformed annotation must not hide other fields. */ }
    }
  });
  const owners = new Map<PDFDict, PDFField>();
  const names = new Map<string, number>();
  for (const field of fields) {
    names.set(field.getName(), (names.get(field.getName()) ?? 0) + 1);
    for (const source of field.acroField.getWidgets()) owners.set(source.dict, field);
  }
  for (const field of fields) {
    const located: LocatedPdfWidget[] = [];
    const sources = field.acroField.getWidgets();
    for (const source of sources) {
      const page = direct.get(source.dict);
      if (page != null) located.push({ page, widget: source, source });
    }
    if (names.get(field.getName()) === 1) for (const entry of pageWidgets) {
      if (owners.has(entry.widget.dict)) continue; // Native references always win.
      try {
        if (fieldName(entry.widget.dict) !== field.getName()) continue;
        if (valueKey(entry.widget.dict, "FT") !== valueKey(field.acroField.dict, "FT")) continue;
        if (valueKey(entry.widget.dict, "V") !== valueKey(field.acroField.dict, "V")) continue;
        const rect = entry.widget.getRectangle();
        if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
        let candidates = sources.filter(source => {
          if (direct.has(source.dict)) return false;
          const declaredPage = source.P();
          if (declaredPage && declaredPage !== pages[entry.page].ref) return false;
          const sourceRect = source.getRectangle();
          if (!(["x", "y", "width", "height"] as const).every(key => Math.abs(rect[key] - sourceRect[key]) < 0.01)) return false;
          return source.getOnValue()?.toString() === entry.widget.getOnValue()?.toString();
        });
        if (candidates.length > 1) {
          const appearance = entry.widget.dict.lookup(PDFName.of("AP"));
          candidates = appearance ? candidates.filter(source => source.dict.lookup(PDFName.of("AP"))?.toString() === appearance.toString()) : [];
        }
        if (candidates.length === 1) located.push({ ...entry, source: candidates[0] });
      } catch { /* An ambiguous/damaged legacy widget remains a panel fallback. */ }
    }
    result.set(field, located);
  }
  return result;
}

/** Called only after an explicit edit, never while opening a PDF. */
export function syncLegacyWidgetAppearances(field: PDFField, widgets: LocatedPdfWidget[]) {
  for (const { widget, source } of widgets) {
    if (widget.dict === source.dict) continue;
    for (const key of ["AP", "AS"] as const) {
      const name = PDFName.of(key), value = source.dict.get(name);
      if (value) widget.dict.set(name, value); else widget.dict.delete(name);
    }
    const value = inherited(field.acroField.dict, "V");
    if (value) widget.dict.set(PDFName.of("V"), value);
    else widget.dict.delete(PDFName.of("V"));
  }
}
