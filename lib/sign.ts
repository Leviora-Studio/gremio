// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { sanitizeWinAnsi } from "@/lib/pdf-edit";

// Sichtbare Platzierung der Signatur: Anteile der Seitenmaße von OBEN-LINKS.
export type SignPlacement = {
  page: number;
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
};

export type SignOptions = {
  p12: Buffer;
  passphrase: string;
  signerName: string;
  dateLabel: string; // vorformatiertes Datum (Europe/Berlin) für die Anzeige
  reason?: string;
  location?: string;
  placement?: SignPlacement; // fehlt → unsichtbare (nur kryptografische) Signatur
  signatureImage?: Buffer; // optionales Unterschriftsbild (PNG/JPG), rein optisch
};

/**
 * Macht das AcroForm-`/Fields`-Array zu einem DIREKTEN Array, falls es als
 * indirekte Referenz gespeichert ist (bei echten Acrobat-/LibreOffice-Formularen
 * üblich). Hintergrund: `@signpdf/placeholder-pdf-lib` prüft `Fields instanceof
 * PDFArray` über `acroForm.get(...)` (ohne Dereferenzieren). Bei indirektem
 * `/Fields` schlägt der Test fehl → die Lib ERSETZT das Array durch ein neues mit
 * nur dem Signaturfeld und löscht so alle Formularfelder. Die AcroForm wird
 * inkonsistent (Feld-Widgets verwaist) und Adobe zeigt die Signatur nicht mehr
 * an. Lösen wir die Referenz vorher auf, ERGÄNZT die Lib korrekt.
 */
function ensureDirectAcroFormFields(doc: PDFDocument): void {
  try {
    const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (!acroForm) return;
    const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fields) acroForm.set(PDFName.of("Fields"), fields);
  } catch {
    // Defensiv: bei exotischen PDFs lieber ohne Normalisierung weiter signieren.
  }
}

/**
 * Signiert ein PDF kryptografisch (PAdES, CMS/PKCS#7 detached) mit dem .p12 des
 * Nutzers. Bei gesetzter Platzierung wird zusätzlich eine sichtbare
 * Signatur-Box gezeichnet (das Signatur-Widget selbst zeichnet nichts).
 */
export async function signPdf(pdf: Buffer, opts: SignOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  // Vorhandene Formularfelder vor dem Signatur-Platzhalter retten (s. Helfer).
  ensureDirectAcroFormFields(doc);
  const pages = doc.getPages();

  let widgetRect: [number, number, number, number] = [0, 0, 0, 0];
  let targetPage = pages[0];

  const pl = opts.placement;
  if (pl && pages[pl.page]) {
    const page = pages[pl.page];
    targetPage = page;
    // MediaBox-Ursprung berücksichtigen (bei Ursprung 0,0 identisch zu getSize()).
    const mb = page.getMediaBox();
    const width = mb.width;
    const height = mb.height;
    const w = Math.max(60, pl.wRatio * width);
    const h = Math.max(28, pl.hRatio * height);
    const x = mb.x + pl.xRatio * width;
    const y = mb.y + height - pl.yRatio * height - h; // oben-links → PDF unten-links
    widgetRect = [x, y, x + w, y + h];

    // Sichtbare Erscheinung selbst zeichnen.
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(0.93, 0.96, 1),
      borderColor: rgb(0.16, 0.39, 0.78),
      borderWidth: 1,
    });
    const pad = 5;
    const fs = Math.max(7, Math.min(11, h / 4.2));
    const name = sanitizeWinAnsi(opts.signerName).slice(0, 60);
    const dateText = sanitizeWinAnsi(opts.dateLabel).slice(0, 40);

    // Optionales Unterschriftsbild einbetten (rein optisch).
    let img = null;
    if (opts.signatureImage) {
      try {
        img = await doc.embedPng(opts.signatureImage);
      } catch {
        try {
          img = await doc.embedJpg(opts.signatureImage);
        } catch {
          img = null;
        }
      }
    }

    if (img) {
      // Bild oben groß, darunter Name + Datum (+ Grund, falls gesetzt).
      const reasonText = opts.reason
        ? sanitizeWinAnsi(opts.reason).slice(0, 60)
        : "";
      const lineH = fs;
      const lines = reasonText ? 3 : 2; // Name, Datum (+ Grund)
      const captionH = pad + lines * lineH;
      const areaW = w - 2 * pad;
      const areaH = h - captionH;
      if (areaW > 4 && areaH > 4) {
        const s = Math.min(areaW / img.width, areaH / img.height);
        const iw = img.width * s;
        const ih = img.height * s;
        page.drawImage(img, {
          x: x + (w - iw) / 2,
          y: y + captionH + (areaH - ih) / 2,
          width: iw,
          height: ih,
        });
      }
      // Zeilen von unten nach oben stapeln: ggf. Grund, dann Datum, dann Name.
      let ty = y + pad * 0.6;
      if (reasonText) {
        page.drawText(reasonText, {
          x: x + pad,
          y: ty,
          size: Math.max(5, fs - 2),
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
        ty += lineH;
      }
      page.drawText(dateText, {
        x: x + pad,
        y: ty,
        size: Math.max(5, fs - 2),
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      ty += lineH;
      page.drawText(name, {
        x: x + pad,
        y: ty,
        size: Math.max(6, fs - 1),
        font: bold,
        color: rgb(0.12, 0.28, 0.55),
      });
    } else {
      page.drawText("Digital signiert", {
        x: x + pad,
        y: y + h - pad - fs,
        size: fs,
        font: bold,
        color: rgb(0.12, 0.28, 0.55),
      });
      page.drawText(name, {
        x: x + pad,
        y: y + h - pad - fs * 2.25,
        size: fs,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page.drawText(dateText, {
        x: x + pad,
        y: y + h - pad - fs * 3.5,
        size: Math.max(6, fs - 1),
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      if (opts.reason) {
        page.drawText(sanitizeWinAnsi(opts.reason).slice(0, 60), {
          x: x + pad,
          y: y + pad,
          size: Math.max(6, fs - 1),
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
    }
  }

  pdflibAddPlaceholder({
    pdfPage: targetPage,
    reason: opts.reason ?? "Digitale Signatur",
    contactInfo: "",
    name: opts.signerName,
    location: opts.location ?? "",
    signingTime: new Date(),
    widgetRect,
    appName: "Gremio",
    // Reservierter Platz für die CMS-Signatur. Default (8192) ist für echte
    // Zertifikate mit Kette/größeren Schlüsseln zu klein ("Signature exceeds
    // placeholder length"). 30000 Byte bieten reichlich Reserve.
    signatureLength: 30000,
  });

  // @signpdf braucht die ByteRange/Contents im Klartext → keine Object Streams.
  const withPlaceholder = await doc.save({ useObjectStreams: false });
  const signer = new P12Signer(opts.p12, { passphrase: opts.passphrase });
  const signed = await new SignPdf().sign(Buffer.from(withPlaceholder), signer);
  return signed;
}
