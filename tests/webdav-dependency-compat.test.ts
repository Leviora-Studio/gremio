// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, getPatcher } from "webdav";

test("the WebDAV client filters a synthetic directory with the patched minimatch dependency", async () => {
  const patcher = getPatcher();
  const entries = ["receipt.pdf", "notes.txt"].map(filename => `<d:response><d:href>/archive/${filename}</d:href><d:propstat><d:prop><d:displayname>${filename}</d:displayname><d:getcontentlength>3</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
  patcher.patch("fetch", () => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`, { status: 207, headers: { "content-type": "application/xml" } }));
  try {
    const client = createClient("https://example.invalid");
    const files = await client.getDirectoryContents("/archive", { glob: "*.pdf" });
    assert.ok(Array.isArray(files));
    assert.deepEqual(files.map(file => file.basename), ["receipt.pdf"]);
  } finally {
    patcher.restore("fetch");
  }
});
