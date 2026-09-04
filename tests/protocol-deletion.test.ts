// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { protocolDeletionPath, resolveProtocolDeletionTarget } from "../lib/protocol-deletion";
import { deleteWebDavEntryWithClient, type WebDavEntry } from "../lib/nextcloud";

const file: WebDavEntry = {
  name: "Protokoll.md", path: "/Protokolle/2026-08-14/Protokoll.md", type: "file",
  fileId: "23", etag: "etag-23", mime: "text/markdown", size: 12, lastModified: null,
};

test("Löschpfade bleiben strikt in der ausgewählten Sitzung", () => {
  assert.equal(protocolDeletionPath("/Protokolle/", "2026-08-14"), "/Protokolle/2026-08-14");
  assert.equal(protocolDeletionPath("/Protokolle", "2026-08-14", "Notizen ä.md"), "/Protokolle/2026-08-14/Notizen ä.md");
  for (const folder of ["", " ", ".", "..", "../Andere", "/", "a/b", "a\\b", "a\0b"]) {
    assert.throws(() => protocolDeletionPath("/Protokolle", folder));
  }
  for (const name of ["", ".", "..", "../fremd.md", "/fremd.md", "Unterordner/Datei.md", "a\nb", "Protokoll.md ", " Protokoll.md", "__PATH_SEPARATOR_POSIX__..__PATH_SEPARATOR_POSIX__fremd.md"]) {
    assert.throws(() => protocolDeletionPath("/Protokolle", "2026-08-14", name));
  }
  for (const root of ["relativ", "/Protokolle/..", "/./Protokolle", "/Protokolle\\Fremd"]) {
    assert.throws(() => protocolDeletionPath(root, "2026-08-14"));
  }
});

test("Löschzielprüfung erkennt ersetzte, umbenannte und typveränderte Dateien", () => {
  assert.equal(resolveProtocolDeletionTarget([file], file.name, "file", "23"), file);
  assert.equal(resolveProtocolDeletionTarget([], file.name, "file", "23"), null);
  assert.throws(() => resolveProtocolDeletionTarget([{ ...file, fileId: "24" }], file.name, "file", "23"), /anderes Löschziel/);
  assert.throws(() => resolveProtocolDeletionTarget([{ ...file, fileId: null }], file.name, "file", "23"), /Identität/);
  assert.throws(() => resolveProtocolDeletionTarget([{ ...file, name: "Neu.md" }], file.name, "file", "23"), /umbenannt/);
  assert.throws(() => resolveProtocolDeletionTarget([{ ...file, type: "directory" }], file.name, "file", "23"), /Typ/);
});

test("WebDAV-Dateilöschung betrifft ausschließlich das gewählte Ziel mit korrekt zitiertem ETag", async () => {
  const deleted: string[] = [];
  const c = {
    deleteFile: async (path: string, options?: { headers?: Record<string, string> }) => {
      assert.deepEqual(options?.headers, { "If-Match": '"etag-23"' });
      deleted.push(path);
    },
  } as Parameters<typeof deleteWebDavEntryWithClient>[0];
  await deleteWebDavEntryWithClient(c, file.path, file.etag);
  assert.deepEqual(deleted, [file.path]);
  await assert.rejects(deleteWebDavEntryWithClient(c, "/", null), /Wurzelordner/);
  await assert.rejects(deleteWebDavEntryWithClient(c, "", null), /Wurzelordner/);
  assert.equal(deleted.length, 1);
});

test("Sitzungslöschung adressiert nur deren Collection, nicht den Bereich oder Nachbarsitzungen", async () => {
  const target = protocolDeletionPath("/Protokolle", "2026-08-14");
  const existing = new Set([target, `${target}/Protokoll.md`, `${target}/Unterlagen/Anlage.pdf`, "/Protokolle/2026-08-15/Protokoll.md"]);
  const c = {
    deleteFile: async (path: string) => {
      for (const entry of existing) if (entry === path || entry.startsWith(`${path}/`)) existing.delete(entry);
    },
  } as Parameters<typeof deleteWebDavEntryWithClient>[0];
  await deleteWebDavEntryWithClient(c, target, null);
  assert.deepEqual([...existing], ["/Protokolle/2026-08-15/Protokoll.md"]);
});

test("WebDAV-Löschen ist bei 404 wiederholbar; Rechte-, Netzwerk- und Konfliktfehler bleiben Fehler", async () => {
  for (const status of [404, 403, 409, 412, 423, 500]) {
    const failure = Object.assign(new Error(`WebDAV ${status}`), { status });
    const c = { deleteFile: async () => { throw failure; } } as Parameters<typeof deleteWebDavEntryWithClient>[0];
    if (status === 404) await deleteWebDavEntryWithClient(c, file.path, file.etag);
    else if (status === 412) await assert.rejects(deleteWebDavEntryWithClient(c, file.path, file.etag), /zwischenzeitlich geändert/);
    else await assert.rejects(deleteWebDavEntryWithClient(c, file.path, file.etag), (error) => error === failure);
  }
});
