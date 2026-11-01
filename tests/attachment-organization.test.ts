// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentArchiveLayout, archiveConflictName, organizationName, sanitizeSegment } from "../lib/attachment-organization";

test("archive root folders obey UTF-8 component limits without splitting characters", () => {
  for (const value of ["€".repeat(120), "😀".repeat(120), "Übersicht".repeat(40)]) {
    const name = sanitizeSegment(value);
    assert.ok(name.length <= 120);
    assert.ok(Buffer.byteLength(name, "utf8") <= 255);
    assert.equal(Buffer.from(name).toString("utf8"), name);
    assert.ok(!name.includes("\ufffd"));
  }
});

test("organization names preserve portable Unicode names and reject unsafe paths", () => {
  assert.equal(organizationName("  Belege  2026  "), "Belege 2026");
  assert.equal(organizationName("Übersicht.pdf"), "Übersicht.pdf");
  for (const name of ["", "\u200b", ".", "..", "../escape", "a/b", "a\\b", "a\0b", "a\nb", "a:b", ".hidden", "trailing.", "x".repeat(121), "€".repeat(100), null, 1]) {
    assert.equal(organizationName(name), null, String(name));
  }
});

test("archives preserve folders, empty folders, and every colliding legacy attachment", () => {
  const folders = [{ id: 1, name: "Belege" }, { id: 2, name: "Leer" }];
  const files = [
    { id: 10, filename: "Antrag.pdf", folderId: null },
    { id: 11, filename: "Quittung.pdf", folderId: 1 },
    { id: 12, filename: "Quittung.pdf", folderId: 1 },
    { id: 13, filename: "QUITTUNG.pdf", folderId: 1 },
    { id: 14, filename: "Belege", folderId: null },
    { id: 15, filename: "Quittung.pdf", folderId: null },
    { id: 16, filename: "../escape.pdf", folderId: null },
  ];
  const layout = attachmentArchiveLayout(folders, files);
  assert.deepEqual(layout.directories, ["Belege", "Leer"]);
  assert.deepEqual(layout.files.map((f) => f.name), ["Antrag.pdf", "Belege/Quittung.pdf", "Belege/Quittung (12).pdf", "Belege/QUITTUNG (13).pdf", "Belege (14)", "Quittung.pdf", "__escape.pdf"]);
  assert.deepEqual(attachmentArchiveLayout([...folders].reverse(), [...files].reverse()), layout, "retry order must not change names");
  assert.equal(new Set(layout.files.map((f) => f.name.toLowerCase())).size, files.length);
  const long = `${"€".repeat(83)}.pdf`;
  const unicode = attachmentArchiveLayout([], [{ id: 20, filename: long, folderId: null }, { id: 21, filename: long, folderId: null }]);
  for (const file of unicode.files) {
    assert.ok(Buffer.byteLength(file.name) <= 255);
    assert.ok(file.name.endsWith(".pdf"));
  }
  assert.throws(() => attachmentArchiveLayout(folders, [{ id: 17, filename: "Lost.pdf", folderId: 99 }]), /Unknown attachment folder/);
});

test("archive collision names stay within filesystem limits even with long legacy extensions", () => {
  const filename = `a.${"€".repeat(100)}`;
  const layout = attachmentArchiveLayout([], [
    { id: 1, filename, folderId: null },
    { id: 2, filename, folderId: null },
  ]);
  for (const file of layout.files) assert.ok(Buffer.byteLength(file.name) <= 255);
  assert.equal(new Set(layout.files.map(file => file.name)).size, 2);
  assert.equal(archiveConflictName("Antrag.pdf", 1), "Antrag_Gremio.pdf");
  assert.equal(archiveConflictName("Antrag.final.PDF", 2), "Antrag.final_Gremio_2.PDF");
  assert.equal(archiveConflictName("Dokument", 1), "Dokument_Gremio");
  for (const sequence of [1, 2, 1000]) {
    const name = archiveConflictName(`${"€".repeat(83)}.pdf`, sequence);
    assert.ok(Buffer.byteLength(name) <= 255);
    assert.ok(name.endsWith(".pdf"));
    assert.ok(name.includes("_Gremio"));
    const legacy = archiveConflictName(filename, sequence);
    assert.ok(Buffer.byteLength(legacy) <= 255);
    assert.ok(legacy.includes("_Gremio"));
    assert.ok(!legacy.includes("\ufffd"));
  }
});

test("Nextcloud uploader creates empty subfolders and writes each file to its planned path", async () => {
  const { build } = await import("esbuild");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createRequire } = await import("node:module");
  const { Readable } = await import("node:stream");
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const directory = await mkdtemp(join(tmpdir(), "gremio-folder-cloud-"));
  const entry = join(directory, "nextcloud.cjs");
  const created: string[] = [];
  const directories = new Set<string>();
  const uploaded: { path: string; content: Buffer }[] = [];
  const stored = new Map<string, Buffer>();
  let stalled = false;
  const context = globalThis as unknown as { __folderTestWebdav?: unknown };
  context.__folderTestWebdav = {
    exists: async (path: string) => directories.has(path),
    createDirectory: async (path: string) => { directories.add(path); created.push(path); },
    putFileContents: async (path: string, content: Buffer, options: { overwrite: boolean }) => {
      assert.equal(options.overwrite, false, "uploads must never overwrite an existing archive");
      if (stored.has(path)) return false;
      stored.set(path, content); uploaded.push({ path, content }); return true;
    },
    createReadStream: (path: string) => stalled ? new Readable({ read() {} }) : Readable.from([stored.get(path)!]),
  };
  try {
    await build({ entryPoints: ["lib/nextcloud.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "local-cloud-double", setup(builder) {
      builder.onResolve({ filter: /^webdav$/ }, () => ({ path: "webdav", namespace: "test" }));
      builder.onResolve({ filter: /^node:fs\/promises$/ }, () => ({ path: "fs", namespace: "test" }));
      builder.onResolve({ filter: /^@\/lib\/attachments$/ }, () => ({ path: "paths", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "webdav" ? 'export const createClient=()=>globalThis.__folderTestWebdav; export const getPatcher=()=>({patch(){}});' : path === "paths" ? 'export const absPath=path=>path;' : 'export const readFile=async path=>Buffer.from(path);', loader: "js" }));
    } }] });
    const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
    loaded._compile(await readFile(entry, "utf8"), entry);
    const options = {
      creds: { url: "https://example.invalid", username: "synthetic", password: "synthetic" },
      targetFolder: "/Archive", subfolder: "Ticket 1",
      folders: [{ id: 1, name: "Belege" }, { id: 2, name: "Leer" }],
      files: [
        { id: 1, relPath: "root-bytes", filename: "Antrag.pdf", folderId: null },
        { id: 2, relPath: "first-bytes", filename: "Beleg.pdf", folderId: 1 },
        { id: 3, relPath: "second-bytes", filename: "Beleg.pdf", folderId: 1 },
      ],
    };
    const folder = await loaded.exports.uploadAntragArchive(options);
    assert.equal(folder, "/Archive/Ticket 1");
    assert.deepEqual(created, ["/Archive", folder, `${folder}/Belege`, `${folder}/Leer`]);
    assert.deepEqual(uploaded.map((f) => [f.path, f.content.toString()]), [
      [`${folder}/Antrag.pdf`, "root-bytes"],
      [`${folder}/Belege/Beleg.pdf`, "first-bytes"],
      [`${folder}/Belege/Beleg (3).pdf`, "second-bytes"],
    ]);
    const other = await loaded.exports.uploadAntragArchive({
      creds: { url: "https://example.invalid", username: "synthetic", password: "synthetic" },
      targetFolder: "/Archive", subfolder: "Ticket 1",
      folders: [], files: [{ id: 4, relPath: "unrelated-ticket", filename: "Antrag.pdf", folderId: null }],
    });
    assert.equal(other, folder, "equal configured names reuse the same folder without an ID suffix");
    assert.equal(created.filter(path => path === folder).length, 1, "existing archive folders are reused");
    assert.equal(stored.get(`${folder}/Antrag.pdf`)!.toString(), "root-bytes");
    assert.equal(stored.get(`${folder}/Antrag_Gremio.pdf`)!.toString(), "unrelated-ticket", "another ticket's differing file is stored beside the original");
    assert.equal(new Set(uploaded.map(file => file.path)).size, uploaded.length);
    assert.equal(await loaded.exports.uploadAntragArchive(options), folder, "identical partial uploads are safely retried");
    assert.equal(uploaded.length, 4, "retry reuses all identical files");
    stored.set(`${folder}/Antrag.pdf`, Buffer.from("Legacy archive contents"));
    assert.equal(await loaded.exports.uploadAntragArchive(options), folder);
    assert.equal(stored.get(`${folder}/Antrag_Gremio_2.pdf`)!.toString(), "root-bytes");
    assert.equal(stored.get(`${folder}/Antrag.pdf`)!.toString(), "Legacy archive contents");
    const afterConflict = uploaded.length;
    await loaded.exports.uploadAntragArchive(options);
    assert.equal(uploaded.length, afterConflict, "retries reuse the identical Gremio copy");
    stored.set(`${folder}/Antrag_Gremio_2.pdf`, Buffer.from("Another existing file"));
    await loaded.exports.uploadAntragArchive(options);
    assert.equal(stored.get(`${folder}/Antrag_Gremio_2.pdf`)!.toString(), "Another existing file");
    assert.equal(stored.get(`${folder}/Antrag_Gremio_3.pdf`)!.toString(), "root-bytes");
    const beforeNumberedRetry = uploaded.length;
    await loaded.exports.uploadAntragArchive(options);
    assert.equal(uploaded.length, beforeNumberedRetry, "numbered fallback files are reused on retry");

    const reservedFolder = "/Archive/Reserved paths";
    stored.set(`${reservedFolder}/Antrag.pdf`, Buffer.from("Foreign content"));
    await loaded.exports.uploadAntragArchive({ ...options, subfolder: "Reserved paths", folders: [], files: [
      { id: 1, relPath: "first-own-file", filename: "Antrag.pdf", folderId: null },
      { id: 2, relPath: "second-own-file", filename: "Antrag_Gremio.pdf", folderId: null },
    ] });
    assert.equal(stored.get(`${reservedFolder}/Antrag.pdf`)!.toString(), "Foreign content");
    assert.equal(stored.get(`${reservedFolder}/Antrag_Gremio.pdf`)!.toString(), "second-own-file");
    assert.equal(stored.get(`${reservedFolder}/Antrag_Gremio_2.pdf`)!.toString(), "first-own-file");

    stored.set(`${folder}/Belege/Beleg.pdf`, Buffer.from("Existing subfolder file"));
    await Promise.all([loaded.exports.uploadAntragArchive(options), loaded.exports.uploadAntragArchive(options)]);
    assert.equal(stored.get(`${folder}/Belege/Beleg.pdf`)!.toString(), "Existing subfolder file");
    assert.equal(stored.get(`${folder}/Belege/Beleg_Gremio.pdf`)!.toString(), "first-bytes");
    assert.equal(stored.has(`${folder}/Belege/Beleg_Gremio_2.pdf`), false, "parallel retries reuse one identical fallback");
    const timeout = AbortSignal.timeout;
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      stalled = true;
      AbortSignal.timeout = () => timeout(10);
      await assert.rejects(loaded.exports.uploadAntragArchive(options), /abort/i, "a stalled remote body must not keep an archive retry open");
    } finally {
      AbortSignal.timeout = timeout;
      clearTimeout(keepAlive);
    }
  } finally {
    delete context.__folderTestWebdav;
    await rm(directory, { recursive: true, force: true });
  }
});
