// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { renderProtocolPdf } from "../lib/protocol-pdf-renderer";

const options = { skip: !process.env.PROTOCOL_PDF_PYTHON && "Set PROTOCOL_PDF_PYTHON to test the installed PDF runtime" };
test("real renderer embeds attachments with the saved width and aspect ratio", options, async () => {
  const image = await sharp({create:{width:400,height:200,channels:4,background:'#447799'}}).png().toBuffer();
  const pdf = await renderProtocolPdf({ markdown: '# Sitzung\n\n![Bild](attachments/Bild%20%C3%A4.png){width=240}', sourceName:'test.md', logo:null, images:{'attachments/Bild ä.png':{data:image.toString('base64'),mime:'image/png'}} });
  const document = await PDFDocument.load(pdf);
  const streams = document.context.enumerateIndirectObjects().filter(([,value])=>value instanceof PDFRawStream && !value.dict.has(PDFName.of('Subtype'))).map(([,value])=>Buffer.from(decodePDFRawStream(value as PDFRawStream).decode()).toString()).join('\n');
  assert.match(streams,/240 0 0 -120 /);
});
test("real renderer reads YAML metadata and creates signatures without date fields", options, async () => {
  const pdf = await renderProtocolPdf({ markdown: '---\ntitle: "YAML title"\nauthor: "Test author"\nsitzungsleitung: Anna\nprotokollfuehrung: Ben\n---\n# Sitzung\n\n## TOP 1\nText mit **Fettdruck**, Umlauten äöü und `Code`.\n', sourceName: "test.md", logo: null, images: {} });
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getTitle(), "Sitzung");
  assert.equal(document.getAuthor(), "Ben");
  assert.equal(document.getForm().getFields().length, 0);
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    for (let index = 0; index < (annotations?.size() ?? 0); index++) {
      const annotation = document.context.lookup(annotations!.get(index), PDFDict);
      assert.notEqual(annotation.get(PDFName.of("Subtype")), PDFName.of("Widget"));
    }
  }
  assert.equal(document.getPageCount(), 1);
});

test("PDF metadata uses the first rendered H1 and protocol author aliases", options, async () => {
  for (const key of ["protokollfuehrung", "protokollfuehrer", "protokollfuehrerin"]) {
    const markdown = `---\n${key}: Bea\ntitle: Ignored\nauthor: Ignored\nunterschriften: false\n---\n\`\`\`md\n# Not a heading\n\`\`\`\n\n## Not the title\n\n# Sitzung **Ä & Ö** [Link](https://example.invalid) \`Code\`\n\n# Later heading\n`;
    const document = await PDFDocument.load(await renderProtocolPdf({ markdown, sourceName: "test.md", logo: null, images: {} }));
    assert.equal(document.getTitle(), "Sitzung Ä & Ö Link Code");
    assert.equal(document.getAuthor(), "Bea");
  }
});

test("PDF metadata falls back to filename and never to a fixed or legacy author", options, async () => {
  const document = await PDFDocument.load(await renderProtocolPdf({ markdown: "---\nauthor: Ignored\ntitle: Ignored\nunterschriften: false\n---\n## Only a subsection\n", sourceName: "Sitzung 01.md", logo: null, images: {} }));
  assert.equal(document.getTitle(), "Sitzung 01");
  assert.ok(!document.getAuthor());
});

test("real renderer disables signatures from YAML and blocks server/network image reads", options, async () => {
  const input = { markdown: '---\nunterschriften: false\n---\n# Ohne Unterschriften\n', sourceName: "test.md", logo: null, images: {} };
  assert.equal((await PDFDocument.load(await renderProtocolPdf(input))).getForm().getFields().length, 0);
  for (const url of ["file:///etc/passwd", "http://127.0.0.1:3000/private", "https://example.invalid/tracker.png"]) await assert.rejects(renderProtocolPdf({ ...input, markdown: `# Test\n![image](${url})` }), /PDF-Erzeugung fehlgeschlagen/);
});
