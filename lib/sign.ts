// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { placeVisibleBox, sanitizeWinAnsi } from "@/lib/pdf-edit";

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
 * Bereitet die AcroForm eines bestehenden Formulars fürs Signieren vor, damit
 * Adobe die Signatur erkennt:
 *
 * 1) `/Fields` zu einem DIREKTEN Array machen. `@signpdf/placeholder-pdf-lib`
 *    prüft `Fields instanceof PDFArray` über `acroForm.get(...)` (ohne zu
 *    dereferenzieren). Bei indirektem `/Fields` (echte Acrobat-/LibreOffice-
 *    Formulare) schlägt der Test fehl → die Lib ERSETZT das Array durch ein neues
 *    mit nur dem Signaturfeld und löscht alle Formularfelder. Vorher auflösen →
 *    die Lib ERGÄNZT korrekt.
 *
 * 2) `/NeedAppearances` entfernen. Steht es auf `true` (typisch bei mit Adobe
 *    Sign erzeugten Formularen), würde Adobe beim Öffnen ALLE Feld-Darstellungen
 *    neu generieren — also das Dokument NACH der Signatur verändern — und zeigt
 *    die Signatur deshalb GAR NICHT an (poppler/qpdf sind hier nachlässiger). Die
 *    Feldwerte haben bereits eigene Appearance-Streams, daher ist das Entfernen
 *    optisch unkritisch.
 */
function prepareAcroFormForSigning(doc: PDFDocument): void {
  try {
    const acroForm = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (!acroForm) return;
    const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
    if (fields) acroForm.set(PDFName.of("Fields"), fields);
    if (acroForm.has(PDFName.of("NeedAppearances"))) {
      acroForm.delete(PDFName.of("NeedAppearances"));
    }
  } catch {
    // Defensiv: bei exotischen PDFs lieber ohne Vorbereitung weiter signieren.
  }
}

/**
 * Signiert ein PDF kryptografisch (PAdES, CMS/PKCS#7 detached) mit dem .p12 des
 * Nutzers. Bei gesetzter Platzierung wird zusätzlich eine sichtbare
 * Signatur-Box gezeichnet (das Signatur-Widget selbst zeichnet nichts).
 */
export async function signPdf(pdf: Buffer, opts: SignOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  // AcroForm fürs Signieren vorbereiten: Felder retten + NeedAppearances entfernen
  // (sonst zeigt Adobe die Signatur bei Formularen nicht an — s. Helfer).
  prepareAcroFormForSigning(doc);
  const pages = doc.getPages();

  let widgetRect: [number, number, number, number] = [0, 0, 0, 0];
  let targetPage = pages[0];

  const pl = opts.placement;
  if (pl && pages[pl.page]) {
    targetPage = pages[pl.page];
    widgetRect = await drawSignatureBox(doc, targetPage, pl, opts);
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

/**
 * Zeichnet die sichtbare Signatur-Box und liefert das Widget-Rechteck. Die Box
 * wird auf der Seite so platziert, wie der Nutzer sie im Browser aufgezogen hat
 * (sichtbare CropBox, Seitenrotation berücksichtigt); gezeichnet wird in einem
 * lokalen, aufrechten Koordinatensystem der Box, damit Name/Datum/Bild auch auf
 * gedrehten Seiten lesbar erscheinen.
 */
export async function drawSignatureBox(
  doc: PDFDocument,
  page: PDFPage,
  pl: SignPlacement,
  opts: Pick<SignOptions, "signerName" | "dateLabel" | "reason" | "signatureImage">,
): Promise<[number, number, number, number]> {
  const { width: w, height: h, rect, matrix } = placeVisibleBox(page, pl, { width: 60, height: 28 });

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pad = 5;
  const fs = Math.max(7, Math.min(11, h / 4.2));
  const name = sanitizeWinAnsi(opts.signerName).slice(0, 60);
  const dateText = sanitizeWinAnsi(opts.dateLabel).slice(0, 40);
  const reasonText = opts.reason ? sanitizeWinAnsi(opts.reason).slice(0, 60) : "";

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

  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  page.drawRectangle({
    x: 0,
    y: 0,
    width: w,
    height: h,
    color: rgb(0.93, 0.96, 1),
    borderColor: rgb(0.16, 0.39, 0.78),
    borderWidth: 1,
  });

  if (img) {
    // Bild oben groß, darunter Name + Datum (+ Grund, falls gesetzt).
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
        x: (w - iw) / 2,
        y: captionH + (areaH - ih) / 2,
        width: iw,
        height: ih,
      });
    }
    // Zeilen von unten nach oben stapeln: ggf. Grund, dann Datum, dann Name.
    let ty = pad * 0.6;
    if (reasonText) {
      page.drawText(reasonText, {
        x: pad,
        y: ty,
        size: Math.max(5, fs - 2),
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      ty += lineH;
    }
    page.drawText(dateText, {
      x: pad,
      y: ty,
      size: Math.max(5, fs - 2),
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    ty += lineH;
    page.drawText(name, {
      x: pad,
      y: ty,
      size: Math.max(6, fs - 1),
      font: bold,
      color: rgb(0.12, 0.28, 0.55),
    });
  } else {
    page.drawText("Digital signiert", {
      x: pad,
      y: h - pad - fs,
      size: fs,
      font: bold,
      color: rgb(0.12, 0.28, 0.55),
    });
    page.drawText(name, {
      x: pad,
      y: h - pad - fs * 2.25,
      size: fs,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(dateText, {
      x: pad,
      y: h - pad - fs * 3.5,
      size: Math.max(6, fs - 1),
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    if (reasonText) {
      page.drawText(reasonText, {
        x: pad,
        y: pad,
        size: Math.max(6, fs - 1),
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }
  page.pushOperators(popGraphicsState());

  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}
