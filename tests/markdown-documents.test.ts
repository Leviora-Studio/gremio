// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { readMarkdownDocument, resolveMarkdownDocument, saveMarkdownDocument, type MarkdownTarget } from "../lib/markdown-documents";
import type { User, ProtocolArea, ProtocolSession } from "../lib/db/schema";

after(async () => { await pool.end(); });
const user = { id: 1 } as User;
const target: MarkdownTarget = { areaId: 2, sessionId: 3, filename: "Notizen.md", folderName: "Sitzung", fileId: "file-1", isProtocol: false };
function setup() {
  const writes: { path: string; content: string }[] = [];
  const deps: NonNullable<Parameters<typeof resolveMarkdownDocument>[2]> = {
    canAccessProtocolArea: async () => true,
    getProtocolAreaById: async id => id === 2 ? { id: 2, rootPath: "/Protokolle" } as ProtocolArea : undefined,
    getProtocolSession: async (a, s) => a === 2 && s === 3 ? { areaId: 2, id: 3, folderName: "Sitzung", folderFileId: "folder-1", protocolPath: "/Protokolle/Sitzung/Protokoll.md", protocolFileId: "file-1" } as ProtocolSession : undefined,
    protocolCredentials: () => ({ url: "https://example.invalid", username: "unused", password: "unused" }),
    statWebDavEntry: async (_c, path) => ({ path, name: path.split("/").pop()!, type: path.endsWith("/Sitzung") ? "directory" : "file", fileId: path.endsWith("/Sitzung") ? "folder-1" : "file-1", size: 50, etag: "etag", mime: "text/markdown", lastModified: null }),
    readWebDavText: async (c, path) => ({ content: "# Notizen\nUnverändert", stat: await deps.statWebDavEntry(c, path) }),
    overwriteWebDavText: async (c, path, content) => { writes.push({ path, content }); return deps.statWebDavEntry(c, path); },
  };
  return { deps, writes };
}
test("ordinary Markdown is read and saved verbatim, with no protocol synchronization", async () => {
  const { deps, writes } = setup();
  assert.equal((await readMarkdownDocument(user, target, deps)).isProtocol, false);
  const source = "---\ncustom: yes\n---\n# Notizen\n<!-- gremio:finance:start card=99 -->\nText";
  await saveMarkdownDocument(user, target, source, deps);
  assert.deepEqual(writes, [{ path: "/Protokolle/Sitzung/Notizen.md", content: source }]);
});

test("nested Markdown uses its exact path without becoming the session protocol", async () => {
  const { deps, writes } = setup();
  const nested = { ...target, filename: "Protokoll.md", subfolder: "Anlagen/Notizen" };
  assert.equal((await readMarkdownDocument(user, nested, deps)).isProtocol, false);
  await saveMarkdownDocument(user, nested, "# Anlage", deps);
  assert.deepEqual(writes, [{ path: "/Protokolle/Sitzung/Anlagen/Notizen/Protokoll.md", content: "# Anlage" }]);
  for (const subfolder of ["../Andere Sitzung", "/Privat", "Anlagen/../../Privat", "Anlagen//Notizen"]) await assert.rejects(saveMarkdownDocument(user, { ...nested, subfolder }, "Nicht speichern", deps));
  assert.equal(writes.length, 1);
});
test("document access rejects foreign scopes, traversal, non-Markdown and changed identities", async () => {
  const { deps, writes } = setup();
  for (const patch of [{ areaId: 9 }, { sessionId: 9 }, { folderName: "Anders" }, { filename: "../Notizen.md" }, { filename: "/Notizen.md" }, { filename: "a\\b.md" }, { filename: "Datei.pdf" }, { filename: "a\0.md" }, { fileId: "replaced" }, { isProtocol: true }]) await assert.rejects(saveMarkdownDocument(user, { ...target, ...patch }, "Text", deps));
  await assert.rejects(readMarkdownDocument(user, target, { ...deps, canAccessProtocolArea: async () => false }));
  await assert.rejects(readMarkdownDocument(user, target, { ...deps, statWebDavEntry: async (c, p) => ({ ...await deps.statWebDavEntry(c, p), fileId: "replacement" }) }));
  await assert.rejects(saveMarkdownDocument(user, target, "x".repeat(2 * 1024 * 1024 + 1), deps));
  assert.deepEqual(writes, []);
});
test("registered protocols cannot use the generic save path or change classification unnoticed", async () => {
  const { deps, writes } = setup();
  const protocolTarget = { ...target, filename: "Protokoll.md", isProtocol: true };
  assert.equal((await resolveMarkdownDocument(user, protocolTarget, deps)).isProtocol, true);
  await assert.rejects(saveMarkdownDocument(user, protocolTarget, "# Sitzung", deps), /Protokollfunktionen/);
  await assert.rejects(resolveMarkdownDocument(user, { ...protocolTarget, isProtocol: false }, deps), /zuordnung/i);
  assert.deepEqual(writes, []);
});
