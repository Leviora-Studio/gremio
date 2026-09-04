// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { protocolDirectoryPath, protocolFilePath, protocolFolderHref, protocolSubfolderSegments } from "../lib/protocol-paths";

test("session folder paths preserve nested names and encode navigation once", () => {
  assert.equal(protocolDirectoryPath("/Protokolle/", "Sitzung"), "/Protokolle/Sitzung");
  assert.equal(protocolFilePath("/Protokolle", "Sitzung", "Notizen.md", "Anlagen/Prüfung #1 & 20%"), "/Protokolle/Sitzung/Anlagen/Prüfung #1 & 20%/Notizen.md");
  const href = protocolFolderHref(2, 3, "Anlagen/Prüfung #1 & 20%");
  assert.equal(new URL(href, "https://example.invalid").searchParams.get("folder"), "Anlagen/Prüfung #1 & 20%");
  assert.equal(protocolFolderHref(2, 3), "/intern/protokolle/2/sitzung/3");
});

test("folder traversal, absolute paths and WebDAV separator tokens are rejected", () => {
  for (const path of ["..", "../Andere Sitzung", "Anlagen/../../Privat", "/Anlagen", "Anlagen/", "Anlagen//PDF", "Anlagen/./PDF", "Anlagen\\PDF", "Anlagen/ PDF", "Anlagen/PDF ", "Anlagen/\0PDF", "Anlagen/__PATH_SEPARATOR_POSIX__", "Anlagen/__PATH_SEPARATOR_WINDOWS__"]) {
    assert.throws(() => protocolSubfolderSegments(path), path);
    assert.throws(() => protocolFilePath("/Protokolle", "Sitzung", "Datei.txt", path), path);
  }
  for (const filename of ["../Datei.txt", "/Datei.txt", "Anlagen/Datei.txt", "..", "", "Datei.txt "]) assert.throws(() => protocolFilePath("/Protokolle", "Sitzung", filename, "Anlagen"));
});
