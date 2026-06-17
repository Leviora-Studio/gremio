// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
};

/**
 * Signiert ein PDF kryptografisch (PAdES, CMS/PKCS#7 detached) mit dem .p12 des
 * Nutzers. Bei gesetzter Platzierung wird zusätzlich eine sichtbare
 * Signatur-Box gezeichnet (das Signatur-Widget selbst zeichnet nichts).
 */
export async function signPdf(pdf: Buffer, opts: SignOptions): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pages = doc.getPages();

  let widgetRect: [number, number, number, number] = [0, 0, 0, 0];
  let targetPage = pages[0];

  const pl = opts.placement;
  if (pl && pages[pl.page]) {
    const page = pages[pl.page];
    targetPage = page;
    const { width, height } = page.getSize();
    const w = Math.max(60, pl.wRatio * width);
    const h = Math.max(28, pl.hRatio * height);
    const x = pl.xRatio * width;
    const y = height - pl.yRatio * height - h; // oben-links → PDF unten-links
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
    page.drawText(sanitizeWinAnsi(opts.dateLabel).slice(0, 40), {
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
