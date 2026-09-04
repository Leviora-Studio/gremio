// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { pool } from "../lib/db";
import { MAX_UPLOAD_BYTES } from "../lib/constants";
import { createProtocolMarkdownFile, uploadProtocolFile, saveProtocolPdf } from "../lib/protocol-file-writes";
import { writeWebDavBinaryWithClient, statWebDavEntryWithClient } from "../lib/nextcloud";
import { applyEditsAndSign } from "../lib/pdf-apply";
import { readPdfFields } from "../lib/pdf-edit";
import type { ProtocolArea, ProtocolSession, User } from "../lib/db/schema";
import type { SavePdfInput } from "../app/intern/card/[id]/pdf-actions";

after(async () => { await pool.end(); });
const user = { id: 1, username: "Tester" } as User;
const area = { id: 2, rootPath: "/Protokolle" } as ProtocolArea;
const session = { id: 3, areaId: 2, folderName: "Sitzung", folderFileId: "folder-3" } as ProtocolSession;
const input: SavePdfInput = { attachmentId: 3, mode: "replace", edits: { fields: [{ name: "topic", value: "Geändert" }] } };
type Deps = NonNullable<Parameters<typeof uploadProtocolFile>[5]>;

function setup() {
  const writes: { path: string; bytes: Buffer; mime: string; replace: boolean }[] = [];
  const deps: Deps = {
    getProtocolAreaById: async id => id === 2 ? area : undefined,
    getProtocolSession: async (areaId, sessionId) => areaId === 2 && sessionId === 3 ? session : undefined,
    canAccessProtocolArea: async () => true,
    protocolCredentials: () => ({ url: "https://example.invalid", username: "unused", password: "secret-for-test" }),
    statWebDavEntry: async (_creds, path) => ({ path, name: path.split("/").pop()!, type: path.endsWith("/Sitzung") ? "directory" : "file", fileId: path.endsWith("/Sitzung") ? "folder-3" : "pdf-1", size: 100, etag: null, mime: "application/pdf", lastModified: null }),
    readWebDavPdf: async () => Buffer.from("%PDF-1.7"),
    applyEditsAndSign,
    writeWebDavBinary: async (_creds, path, bytes, mime, replace) => { writes.push({ path, bytes, mime, replace }); return true; },
  };
  return { deps, writes };
}

test("new Markdown files are empty, exclusive and created in the selected folder", async () => {
  const { deps } = setup();
  const created: { path: string; content: string }[] = [];
  const io = { ...deps, createWebDavTextExclusive: async (_creds: unknown, path: string, content: string) => { created.push({ path, content }); return { created: true }; } };
  assert.deepEqual(await createProtocolMarkdownFile(user, 2, 3, "Sitzung", "Notizen", io), { filename: "Notizen.md" });
  io.statWebDavEntry = async (creds, path) => path.endsWith("/Anlagen/Details") ? { ...await deps.statWebDavEntry(creds, path), type: "directory" } : deps.statWebDavEntry(creds, path);
  const folder = { folderName: "Sitzung", subfolder: "Anlagen/Details" };
  assert.deepEqual(await createProtocolMarkdownFile(user, 2, 3, folder, "Übersicht.MD", io), { filename: "Übersicht.MD" });
  assert.deepEqual(created, [{ path: "/Protokolle/Sitzung/Notizen.md", content: "" }, { path: "/Protokolle/Sitzung/Anlagen/Details/Übersicht.MD", content: "" }]);
  const collision = await createProtocolMarkdownFile(user, 2, 3, folder, "Notizen.md", { ...io, createWebDavTextExclusive: async () => ({ created: false }) });
  assert.match(collision.error!, /existiert bereits.*nicht überschrieben/);
  assert.equal(collision.filename, undefined);
  for (const name of ["", " ", ".md", "../Datei", "a/b", "a\\b", "x\0x", "ü".repeat(128), "__PATH_SEPARATOR_POSIX__x"]) assert.ok((await createProtocolMarkdownFile(user, 2, 3, folder, name, io)).error);
  assert.ok((await createProtocolMarkdownFile(user, 2, 3, { ...folder, subfolder: "../Privat" }, "Notizen", io)).error);
  assert.ok((await createProtocolMarkdownFile(user, 2, 3, { ...folder, subfolder: "Datei.txt" }, "Notizen", io)).error);
  assert.ok((await createProtocolMarkdownFile(user, 2, 4, folder, "Notizen", io)).error);
  assert.ok((await createProtocolMarkdownFile(user, 2, 3, folder, "Notizen", { ...io, canAccessProtocolArea: async () => false })).error);
  assert.ok((await createProtocolMarkdownFile(user, 2, 3, "Renamed", "Notizen", io)).error);
  assert.equal(created.length, 2);
});

test("Upload erhält Dateiname und Bytes und überschreibt keine vorhandene Datei", async () => {
  const { deps, writes } = setup();
  const bytes = new Uint8Array([0, 255, 13, 10]);
  const file = new File([bytes], "Unterlagen ä.zip", { type: "application/zip" });
  assert.ok((await uploadProtocolFile(user, 2, 3, "Sitzung", file, deps)).success);
  assert.deepEqual(writes, [{ path: "/Protokolle/Sitzung/Unterlagen ä.zip", bytes: Buffer.from(bytes), mime: "application/zip", replace: false }]);
  const conflict = await uploadProtocolFile(user, 2, 3, "Sitzung", file, { ...deps, writeWebDavBinary: async () => false });
  assert.match(conflict.error!, /existiert bereits.*nicht überschrieben/);
});

test("nested uploads and PDF saves target only the selected session subfolder", async () => {
  const { deps, writes } = setup();
  const stat = deps.statWebDavEntry;
  deps.statWebDavEntry = async (creds, path) => path === "/Protokolle/Sitzung/Anlagen/Prüfung" ? { ...await stat(creds, path), type: "directory" } : stat(creds, path);
  const location = { folderName: "Sitzung", subfolder: "Anlagen/Prüfung" };
  assert.ok((await uploadProtocolFile(user, 2, 3, location, new File(["Test"], "Datei.txt"), deps)).success);
  assert.equal(writes[0].path, "/Protokolle/Sitzung/Anlagen/Prüfung/Datei.txt");
  assert.equal(writes[0].replace, false);
  deps.applyEditsAndSign = async () => ({ ok: true, pdf: Buffer.from("%PDF-1.7\nEdited"), signed: false });
  assert.ok((await saveProtocolPdf(user, 2, 3, location, "Anlage.pdf", "pdf-1", input, deps)).ok);
  assert.equal(writes[1].path, "/Protokolle/Sitzung/Anlagen/Prüfung/Anlage.pdf");
  assert.equal(writes[1].replace, true);
  for (const subfolder of ["../Andere Sitzung", "/Privat", "Anlagen/../../Privat", "Anlagen//Prüfung", "Anlage.pdf"]) {
    assert.ok((await uploadProtocolFile(user, 2, 3, { ...location, subfolder }, new File(["Test"], "Datei.txt"), deps)).error);
    assert.equal((await saveProtocolPdf(user, 2, 3, { ...location, subfolder }, "Anlage.pdf", "pdf-1", input, deps)).ok, false);
  }
  assert.equal(writes.length, 2);
});

test("Upload prüft Rechte, Sitzung, Dateiname, Dateigröße und Ordneridentität vor dem Schreiben", async () => {
  const { deps, writes } = setup();
  const file = new File(["Test"], "Datei.txt");
  for (const [a, s, folder] of [[2, 4, "Sitzung"], [4, 3, "Sitzung"], [2, 3, "Andere Sitzung"], [NaN, 3, "Sitzung"]] as const) assert.ok((await uploadProtocolFile(user, a, s, folder, file, deps)).error);
  assert.match((await uploadProtocolFile(user, 2, 3, "Sitzung", file, { ...deps, canAccessProtocolArea: async () => false })).error!, /Kein Zugriff/);
  for (const name of ["../Datei.txt", "a/b.txt", "a\\b.txt", ".htaccess", "x\0.txt", "x.txt ", "ü".repeat(128), "__PATH_SEPARATOR_POSIX__x"]) assert.ok((await uploadProtocolFile(user, 2, 3, "Sitzung", new File(["Test"], name), deps)).error);
  for (const bytes of [new Uint8Array(0), new Uint8Array(MAX_UPLOAD_BYTES + 1)]) assert.ok((await uploadProtocolFile(user, 2, 3, "Sitzung", new File([bytes], "Datei.txt"), deps)).error);
  const changed = { ...deps, statWebDavEntry: async () => ({ ...await deps.statWebDavEntry({} as never, "x"), fileId: "different" }) };
  assert.match((await uploadProtocolFile(user, 2, 3, "Sitzung", file, changed)).error!, /Sitzungsordner wurde verändert/);
  assert.equal(writes.length, 0);
});

test("PDF-Editor schreibt echte Formularänderungen zurück in das ausgewählte Nextcloud-PDF", async () => {
  const { deps, writes } = setup();
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField("topic");
  field.setText("Original"); field.addToPage(page, { x: 20, y: 20, width: 200, height: 20 });
  const original = Buffer.from(await doc.save());
  deps.readWebDavPdf = async () => original;
  const result = await saveProtocolPdf(user, 2, 3, "Sitzung", "Anlage.pdf", "pdf-1", input, deps);
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/Protokolle/Sitzung/Anlage.pdf");
  assert.equal(writes[0].replace, true);
  assert.equal(writes[0].mime, "application/pdf");
  assert.equal((await readPdfFields(writes[0].bytes)).find(field => field.name === "topic")?.value, "Geändert");
  assert.equal((await readPdfFields(original)).find(field => field.name === "topic")?.value, "Original");
});

test("PDF-Speichern schützt andere Sitzungen, ersetzte Dateien, Fehler und Größenlimit", async () => {
  const { deps, writes } = setup();
  deps.applyEditsAndSign = async () => ({ ok: true, pdf: Buffer.from("%PDF-1.7\nEdited"), signed: false });
  for (const [a, s, name, id, request] of [[4, 3, "Anlage.pdf", "pdf-1", input], [2, 4, "Anlage.pdf", "pdf-1", input], [2, 3, "../Andere.pdf", "pdf-1", input], [2, 3, "Anlage.pdf", "replaced", input], [2, 3, "Anlage.pdf", "pdf-1", { ...input, attachmentId: 9 }], [2, 3, "Anlage.pdf", "pdf-1", { ...input, mode: "new" as const }]] as const) {
    assert.equal((await saveProtocolPdf(user, a, s, "Sitzung", name, id, request, deps)).ok, false);
  }
  assert.equal((await saveProtocolPdf(user, 2, 3, "Sitzung", "Anlage.pdf", "pdf-1", input, { ...deps, canAccessProtocolArea: async () => false })).ok, false);
  for (const applyEditsAndSign of [async () => ({ ok: false as const, error: "Invalid PDF" }), async () => ({ ok: true as const, signed: false, pdf: Buffer.alloc(MAX_UPLOAD_BYTES + 1) })]) assert.equal((await saveProtocolPdf(user, 2, 3, "Sitzung", "Anlage.pdf", "pdf-1", input, { ...deps, applyEditsAndSign })).ok, false);
  let originalChecks = 0;
  const changedDuringEdit = { ...deps, statWebDavEntry: async (creds: Parameters<Deps["statWebDavEntry"]>[0], path: string) => {
    const entry = await deps.statWebDavEntry(creds, path);
    if (entry.type === "file" && ++originalChecks === 2) entry.fileId = "other";
    return entry;
  } };
  assert.equal((await saveProtocolPdf(user, 2, 3, "Sitzung", "Anlage.pdf", "pdf-1", input, changedDuringEdit)).ok, false);
  assert.equal(writes.length, 0);
  const failed = await saveProtocolPdf(user, 2, 3, "Sitzung", "Anlage.pdf", "pdf-1", input, { ...deps, writeWebDavBinary: async () => { throw new Error("secret-for-test"); } });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.ok(!failed.error.includes("secret-for-test"));
});

test("Binär-PUT verwendet atomaren Kollisionsschutz nur beim Upload", async () => {
  const bytes = Buffer.from("%PDF-1.7");
  for (const replace of [false, true]) {
    const client = { customRequest: async (path: string, options: { method: string; headers: Record<string, string>; data: Buffer; signal: AbortSignal }) => {
      assert.equal(path, "/Sitzung/Anlage.pdf"); assert.equal(options.method, "PUT"); assert.deepEqual(options.data, bytes);
      assert.deepEqual(options.headers, { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), ...(!replace ? { "If-None-Match": "*" } : {}) });
      assert.ok(options.signal);
    } } as unknown as Parameters<typeof writeWebDavBinaryWithClient>[0];
    assert.equal(await writeWebDavBinaryWithClient(client, "/Sitzung/Anlage.pdf", bytes, "application/pdf", replace), true);
  }
  for (const status of [403, 409, 412, 500]) {
    const error = Object.assign(new Error("Upstream error"), { status });
    const client = { customRequest: async () => { throw error; } };
    if (status === 412) assert.equal(await writeWebDavBinaryWithClient(client, "/x", bytes, "application/pdf", false), false);
    else await assert.rejects(writeWebDavBinaryWithClient(client, "/x", bytes, "application/pdf", false), error);
    await assert.rejects(writeWebDavBinaryWithClient(client, "/x", bytes, "application/pdf", true), error);
  }
  const noWrite = { customRequest: async () => { assert.fail("Must not write invalid data"); } };
  await assert.rejects(writeWebDavBinaryWithClient(noWrite, "/x", Buffer.alloc(MAX_UPLOAD_BYTES + 1), "application/pdf", false), /25 MB/);
  await assert.rejects(writeWebDavBinaryWithClient(noWrite, "/x", bytes, "application/pdf\r\nX: y", false), /Dateityp/);
});

test("WebDAV-stat fragt fehlende Nextcloud-Datei-IDs explizit mit Depth 0 ab", async () => {
  const client = {
    stat: async () => ({ filename: "/Sitzung/Anlage.pdf", basename: "Anlage.pdf", type: "file", size: 10, etag: null }),
    customRequest: async (path: string, options: { method: string; headers: Record<string, string> }) => {
      assert.equal(path, "/Sitzung/Anlage.pdf"); assert.equal(options.method, "PROPFIND"); assert.equal(options.headers.Depth, "0");
      return new Response('<d:multistatus><d:response><d:href>/remote.php/dav/files/user/Sitzung/Anlage.pdf</d:href><oc:fileid>123</oc:fileid></d:response></d:multistatus>');
    },
  } as unknown as Parameters<typeof statWebDavEntryWithClient>[0];
  assert.equal((await statWebDavEntryWithClient(client, "/Sitzung/Anlage.pdf")).fileId, "123");
});
