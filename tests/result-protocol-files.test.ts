// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import type { MarkdownTarget } from "../lib/markdown-documents";
import { saveResultProtocol } from "../lib/result-protocol-files";
import type { ProtocolArea, ProtocolSession, User } from "../lib/db/schema";

after(async () => { await pool.end(); });

const user = { id: 7 } as User;
const source: MarkdownTarget = { areaId: 2, sessionId: 3, filename: "Protokoll.md", folderName: "Sitzung", fileId: "source-1", isProtocol: true };
const area = { id: 2, name: "Testbereich", rootPath: "/Protokolle", resultFilePattern: "Ergebnisprotokoll.md" } as ProtocolArea;
const session = { id: 3, areaId: 2, folderName: "Sitzung", sessionDate: "2026-09-04", folderFileId: "folder-1" } as ProtocolSession;
const entry = (name: string, fileId: string) => ({ path: `/Protokolle/Sitzung/${name}`, name, type: "file" as const, fileId, size: 20, etag: "etag", mime: "text/markdown", lastModified: null });

function setup() {
  const creates: { path: string; content: string }[] = [];
  const saves: { target: MarkdownTarget; content: string }[] = [];
  const sourceContext = { area, session, file: entry("Protokoll.md", "source-1"), path: "/Protokolle/Sitzung/Protokoll.md", creds: { url: "https://example.invalid", username: "unused", password: "unused" }, isProtocol: true };
  const resultContext = { ...sourceContext, file: entry("Ergebnisprotokoll.md", "result-1"), path: "/Protokolle/Sitzung/Ergebnisprotokoll.md", isProtocol: false };
  const deps = {
    resolveMarkdownDocument: async (_user: User, target: MarkdownTarget) => target.filename === "Protokoll.md" ? sourceContext : resultContext,
    createWebDavTextExclusive: async (_creds: unknown, path: string, content: string): Promise<{ created: boolean; stat?: ReturnType<typeof entry> }> => { creates.push({ path, content }); return { created: true, stat: resultContext.file }; },
    readMarkdownDocument: async () => ({ ...resultContext, content: "# Vorhandenes Ergebnis" }),
    saveMarkdownDocument: async (_user: User, target: MarkdownTarget, content: string) => { saves.push({ target, content }); return { savedToNextcloud: true, content, success: "In Nextcloud gespeichert." }; },
  };
  return { deps, creates, saves };
}

test("first save exclusively creates Ergebnisprotokoll.md beside the registered protocol", async () => {
  const { deps, creates, saves } = setup();
  const result = await saveResultProtocol(user, source, "Ergebnisprotokoll.md", undefined, "# Ergebnis", deps as never);
  assert.equal(result.fileId, "result-1");
  assert.equal(result.openedExisting, undefined);
  assert.deepEqual(creates, [{ path: "/Protokolle/Sitzung/Ergebnisprotokoll.md", content: "# Ergebnis" }]);
  assert.deepEqual(saves, []);
});

test("exclusive collision opens the existing result without overwriting it", async () => {
  const { deps, creates, saves } = setup();
  deps.createWebDavTextExclusive = async (_creds: unknown, path: string, content: string) => { creates.push({ path, content }); return { created: false, stat: undefined }; };
  const result = await saveResultProtocol(user, source, "Ergebnisprotokoll.md", undefined, "# Neuer Entwurf", deps as never);
  assert.equal(result.openedExisting, true);
  assert.equal(result.content, "# Vorhandenes Ergebnis");
  assert.equal(result.fileId, "result-1");
  assert.deepEqual(saves, []);
});

test("subsequent saves require the result identity and never write the source target", async () => {
  const { deps, creates, saves } = setup();
  const sourceBefore = { ...source };
  const result = await saveResultProtocol(user, source, "Ergebnisprotokoll.md", "result-1", "# Geändert", deps as never);
  assert.equal(result.savedToNextcloud, true);
  assert.equal(creates.length, 0);
  assert.deepEqual(saves, [{ target: { areaId: 2, sessionId: 3, filename: "Ergebnisprotokoll.md", folderName: "Sitzung", fileId: "result-1", isProtocol: false }, content: "# Geändert" }]);
  assert.deepEqual(source, sourceBefore);
});

test("missing source permission/identity and size violations prevent every result write", async () => {
  const { deps, creates, saves } = setup();
  const denied = { ...deps, resolveMarkdownDocument: async () => { throw new Error("Kein Zugriff"); } };
  await assert.rejects(saveResultProtocol(user, source, "Ergebnisprotokoll.md", undefined, "# Ergebnis", denied as never), /Kein Zugriff/);
  await assert.rejects(saveResultProtocol(user, source, "Ergebnisprotokoll.md", undefined, "x".repeat(2_000_001), deps as never), /2 MB/);
  await assert.rejects(saveResultProtocol(user, { ...source, subfolder: "Anlagen" }, "Ergebnisprotokoll.md", undefined, "# Ergebnis", deps as never), /registrierten Protokolldatei/);
  assert.equal(creates.length, 0);
  assert.equal(saves.length, 0);
});

test("the configured result filename is rendered server-side and schema changes require reopening", async () => {
  const { deps, creates } = setup();
  const configuredArea = { ...area, resultFilePattern: "Ergebnis-{date}-{area}.md" };
  deps.resolveMarkdownDocument = async (_user: User, target: MarkdownTarget) => target.filename === "Protokoll.md"
    ? { area: configuredArea, session, file: entry("Protokoll.md", "source-1"), path: "/Protokolle/Sitzung/Protokoll.md", creds: { url: "https://example.invalid", username: "unused", password: "unused" }, isProtocol: true }
    : { area: configuredArea, session, file: entry(target.filename, "result-1"), path: `/Protokolle/Sitzung/${target.filename}`, creds: { url: "https://example.invalid", username: "unused", password: "unused" }, isProtocol: false };
  const filename = "Ergebnis-2026-09-04-Testbereich.md";
  await saveResultProtocol(user, source, filename, undefined, "# Ergebnis", deps as never);
  assert.deepEqual(creates, [{ path: `/Protokolle/Sitzung/${filename}`, content: "# Ergebnis" }]);
  await assert.rejects(saveResultProtocol(user, source, "Ergebnisprotokoll.md", undefined, "# Ergebnis", deps as never), /geändert/);
});

test("the configured result filename cannot collide with the registered source", async () => {
  const { deps, creates, saves } = setup();
  const collidingArea = { ...area, resultFilePattern: "{session}.md" };
  const collidingSession = { ...session, folderName: "Protokoll" };
  deps.resolveMarkdownDocument = async () => ({ area: collidingArea, session: collidingSession, file: entry("Protokoll.md", "source-1"), path: "/Protokolle/Protokoll/Protokoll.md", creds: { url: "https://example.invalid", username: "unused", password: "unused" }, isProtocol: true });
  await assert.rejects(saveResultProtocol(user, source, "Protokoll.md", undefined, "# Ergebnis", deps as never), /unterschiedliche Namen/);
  assert.deepEqual(creates, []); assert.deepEqual(saves, []);
});
