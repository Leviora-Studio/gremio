// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentArchiveLayout, organizationName } from "../lib/attachment-organization";

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

test("Nextcloud uploader creates empty subfolders and writes each file to its planned path", async () => {
  const { build } = await import("esbuild");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const directory = await mkdtemp(join(tmpdir(), "gremio-folder-cloud-"));
  const entry = join(directory, "nextcloud.cjs");
  const created: string[] = [];
  const uploaded: { path: string; content: Buffer }[] = [];
  const context = globalThis as unknown as { __folderTestWebdav?: unknown };
  context.__folderTestWebdav = {
    exists: async () => false,
    createDirectory: async (path: string) => { created.push(path); },
    putFileContents: async (path: string, content: Buffer) => { uploaded.push({ path, content }); },
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
    const folder = await loaded.exports.uploadAntragArchive({
      creds: { url: "https://example.invalid", username: "synthetic", password: "synthetic" },
      targetFolder: "/Archive", subfolder: "Ticket 1",
      folders: [{ id: 1, name: "Belege" }, { id: 2, name: "Leer" }],
      files: [
        { id: 1, relPath: "root-bytes", filename: "Antrag.pdf", folderId: null },
        { id: 2, relPath: "first-bytes", filename: "Beleg.pdf", folderId: 1 },
        { id: 3, relPath: "second-bytes", filename: "Beleg.pdf", folderId: 1 },
      ],
    });
    assert.equal(folder, "/Archive/Ticket 1");
    assert.deepEqual(created, ["/Archive", folder, `${folder}/Belege`, `${folder}/Leer`]);
    assert.deepEqual(uploaded.map((f) => [f.path, f.content.toString()]), [
      [`${folder}/Antrag.pdf`, "root-bytes"],
      [`${folder}/Belege/Beleg.pdf`, "first-bytes"],
      [`${folder}/Belege/Beleg (3).pdf`, "second-bytes"],
    ]);
  } finally {
    delete context.__folderTestWebdav;
    await rm(directory, { recursive: true, force: true });
  }
});
