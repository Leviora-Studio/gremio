// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import forge from "node-forge";
import { PDFDocument, PDFArray, PDFDict, PDFHexString, PDFName, PDFSignature, PDFStream, degrees } from "pdf-lib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { placeVisibleBox } from "../lib/pdf-edit";
import { mergeSinglePdfWidget } from "../lib/pdf-widget-compat";
import { validatePdfInteroperability } from "./helpers/pdf-signature-validation";
import { extractPdfText } from "../lib/pdf-text";
import { signPdf, signPdfIncremental, appendPdfSignatureDetails } from "../lib/sign";
function certificate(name: string) { const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = "01"; cert.validity.notBefore = new Date(Date.now() - 1000); cert.validity.notAfter = new Date(Date.now() + 86400000); cert.setSubject([{ name: "commonName", value: name }]); cert.setIssuer(cert.subject.attributes); cert.sign(keys.privateKey, forge.md.sha256.create()); return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "test-only", { algorithm: "3des" })).getBytes(), "binary"); }
test("second cashbook signature appends bytes and both CMS signatures remain cryptographically valid", async () => { const folder = await mkdtemp(join(tmpdir(), "gremio-cashbook-sign-")); try {
    const doc = await PDFDocument.create();
    const page = doc.addPage();page.drawText("Cashbook fixture");
    const field = doc.getForm().createTextField("SecondPlaceDate");
    field.addToPage(page,{x:50,y:400,width:350,height:25});field.setText("");field.enableReadOnly();
    doc.getForm().updateFieldAppearances();mergeSinglePdfWidget(doc,field);
    const original = Buffer.from(await doc.save());
    const first = await signPdf(original, { p12: certificate("First signer"), passphrase: "test-only", signerName: "First signer", dateLabel: "13.11.2026", placement: { page: 0, xRatio: .1, yRatio: .6, wRatio: .3, hRatio: .1 } });
    const prepared = await appendPdfSignatureDetails(first, "SecondPlaceDate", "Berlin, 14.11.2026");
    assert.equal(prepared.subarray(0,first.length).equals(first),true);
    assert.match((await extractPdfText(prepared)).text,/Berlin, 14\.11\.2026/);
    const second = await signPdfIncremental(prepared, { p12: certificate("Second signer"), passphrase: "test-only", signerName: "Second signer", dateLabel: "13.11.2026", placement: { page: 0, xRatio: .5, yRatio: .6, wRatio: .3, hRatio: .1 } });
    assert.equal(second.subarray(0, first.length).equals(first), true, "original signed bytes must remain untouched");
    assert.equal(second.subarray(0,prepared.length).equals(prepared),true);
    const ranges = [...second.toString("latin1").matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
    assert.equal(ranges.length, 2);
    for (const [index, match] of ranges.entries()) {
        const [a, b, c, d] = match.slice(1).map(Number);
        const contents = Buffer.concat([second.subarray(a, a + b), second.subarray(c, c + d)]);
        const signature = Buffer.from(second.subarray(b + 1, c - 1).toString("latin1").replace(/\s/g, ""), "hex");
        await writeFile(join(folder, `content-${index}`), contents);
        await writeFile(join(folder, `signature-${index}`), signature);
        const verified = spawnSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", join(folder, `signature-${index}`), "-content", join(folder, `content-${index}`), "-noverify", "-out", join(folder, `verified-${index}`)], { encoding: "utf8" });
        assert.equal(verified.status, 0, verified.stderr);
    }
    const parsed = await PDFDocument.load(second);
    const signatures = parsed.getForm().getFields().filter(field => field instanceof PDFSignature);
    assert.deepEqual(signatures.map(field=>field.getName()),["Signature1","Signature2"]);
    for (const field of signatures) {
        const value = field.acroField.dict.lookup(PDFName.of("V"),PDFDict);
        const range = value.lookup(PDFName.of("ByteRange"),PDFArray).asArray().map(n=>Number(n.toString()));
        const contents = value.lookup(PDFName.of("Contents"),PDFHexString).asBytes();
        assert.ok(Buffer.from(contents).equals(Buffer.from(second.subarray(range[1]+1,range[2]-1).toString("latin1"),"hex")), "each field excludes exactly its own Contents");
    }
    assert.equal(parsed.getPages()[0].node.Contents()?.toString(),(await PDFDocument.load(first)).getPages()[0].node.Contents()?.toString(),"signing never repaints signed pages");
    assert.equal(parsed.getForm().getTextField("SecondPlaceDate").isReadOnly(),true);
    await writeFile(join(folder,"final.pdf"),second);
    validatePdfInteroperability(join(folder,"final.pdf"),2);
    assert.equal(parsed.getPageCount(), 1);
}
finally {
    await rm(folder, { recursive: true, force: true });
} });


test("ordinary follow-up signatures retain all revisions and use unique widget fields", async () => {
    const folder = await mkdtemp(join(tmpdir(), "gremio-attachment-sign-"));
    try {
        const doc = await PDFDocument.create();const page = doc.addPage([600,800]);page.setCropBox(25,40,500,700);page.setRotation(degrees(90));
        const opts = {p12:certificate("Attachment signer"),passphrase:"test-only",signerName:"Attachment signer",dateLabel:"15.11.2026",placement:{page:0,xRatio:.1,yRatio:.5,wRatio:.3,hRatio:.1}};
        const first = await signPdf(Buffer.from(await doc.save()),opts);
        const second = await signPdf(first,{...opts,placement:{...opts.placement,xRatio:.5}});
        const third = await signPdf(second,{...opts,placement:{...opts.placement,yRatio:.7}});
        assert.ok(second.subarray(0,first.length).equals(first));
        assert.ok(third.subarray(0,second.length).equals(second));
        assert.deepEqual((await PDFDocument.load(third)).getForm().getFields().map(field=>field.getName()),["Signature1","Signature2","Signature3"]);
        const parsed = await PDFDocument.load(third);
        const firstWidget = parsed.getForm().getFields()[0].acroField.dict;
        const box = placeVisibleBox(parsed.getPages()[0],opts.placement,{width:60,height:28});
        assert.deepEqual(firstWidget.lookup(PDFName.of("Rect"),PDFArray).asArray().map(n=>Number(n.toString())),[box.rect.x,box.rect.y,box.rect.x+box.rect.width,box.rect.y+box.rect.height]);
        const appearance = firstWidget.lookup(PDFName.of("AP"),PDFDict).lookup(PDFName.of("N"),PDFStream);
        assert.deepEqual(appearance.dict.lookup(PDFName.of("Matrix"),PDFArray).asArray().map(n=>Number(n.toString())),[...box.matrix.slice(0,4),box.matrix[4]-box.rect.x,box.matrix[5]-box.rect.y]);
        await writeFile(join(folder,"final.pdf"),third);validatePdfInteroperability(join(folder,"final.pdf"),3);
    } finally { await rm(folder,{recursive:true,force:true}); }
});
