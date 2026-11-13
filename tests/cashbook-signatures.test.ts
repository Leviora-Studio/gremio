// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { extractPdfText } from "../lib/pdf-text";
import { signPdf, signPdfIncremental, appendPdfTextIncremental } from "../lib/sign";
function certificate(name: string) { const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = "01"; cert.validity.notBefore = new Date(Date.now() - 1000); cert.validity.notAfter = new Date(Date.now() + 86400000); cert.setSubject([{ name: "commonName", value: name }]); cert.setIssuer(cert.subject.attributes); cert.sign(keys.privateKey, forge.md.sha256.create()); return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "test-only", { algorithm: "3des" })).getBytes(), "binary"); }
test("second cashbook signature appends bytes and both CMS signatures remain cryptographically valid", async () => { const folder = await mkdtemp(join(tmpdir(), "gremio-cashbook-sign-")); try {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Cashbook fixture");
    const original = Buffer.from(await doc.save());
    const first = await signPdf(original, { p12: certificate("First signer"), passphrase: "test-only", signerName: "First signer", dateLabel: "13.11.2026", placement: { page: 0, xRatio: .1, yRatio: .6, wRatio: .3, hRatio: .1 } });
    const prepared = await appendPdfTextIncremental(first, [{placement:{page:0,xRatio:.1,yRatio:.4,wRatio:.5,hRatio:.04},text:"Berlin, 14.11.2026"}]);
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
    assert.equal((await PDFDocument.load(second)).getPageCount(), 1);
}
finally {
    await rm(folder, { recursive: true, force: true });
} });
