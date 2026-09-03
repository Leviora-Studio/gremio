// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWebDavDirectoryExclusiveWithClient,
  createWebDavTextExclusiveWithClient,
  joinWebDavPath,
  nextcloudBrowserUrl,
  WebDavConflictError,
  webDavWriteConditionHeaders,
  writeWebDavTextIfMatchWithClient,
} from "../lib/nextcloud";

test("WebDAV-Speichern verwendet ETag oder Änderungszeit als Schreibbedingung", () => {
  assert.deepEqual(webDavWriteConditionHeaders('"etag-42"'), { "If-Match": '"etag-42"' });
  assert.deepEqual(webDavWriteConditionHeaders("lastmod:Fri, 14 Aug 2026 12:00:00 GMT"), {
    "If-Unmodified-Since": "Fri, 14 Aug 2026 12:00:00 GMT",
  });
  assert.throws(() => webDavWriteConditionHeaders(""), /Versionsstand/);
});

test("Nextcloud-Links enthalten weder Zugangsdaten noch verlieren sie einen Installations-Unterpfad", () => {
  const webDav = "https://cloud.example/nextcloud/remote.php/dav/files/alice";
  assert.equal(nextcloudBrowserUrl(webDav, "/Protokolle/2026-08-14", "123"), "https://cloud.example/nextcloud/f/123");
  const fallback = nextcloudBrowserUrl(webDav, "/Protokolle/2026-08-14/Protokoll.md");
  assert.match(fallback, /^https:\/\/cloud\.example\/nextcloud\/index\.php\/apps\/files\//);
  assert.match(fallback, /dir=%2FProtokolle%2F2026-08-14/);
  assert.equal(joinWebDavPath("/Protokolle/", "/2026-08-14/", "Protokoll.md"), "/Protokolle/2026-08-14/Protokoll.md");
});

test("vorhandene oder parallel angelegte Sitzungsordner werden nicht verändert", async () => {
  let createCalls = 0;
  const existingClient = {
    exists: async () => true,
    createDirectory: async () => {
      createCalls += 1;
    },
  } as Parameters<typeof createWebDavDirectoryExclusiveWithClient>[0];
  assert.equal(
    await createWebDavDirectoryExclusiveWithClient(existingClient, "/Protokolle/2026-08-14"),
    false,
  );
  assert.equal(createCalls, 0);

  let existenceChecks = 0;
  const racingClient = {
    exists: async () => ++existenceChecks > 1,
    createDirectory: async () => {
      throw new Error("409 Conflict");
    },
  } as Parameters<typeof createWebDavDirectoryExclusiveWithClient>[0];
  assert.equal(
    await createWebDavDirectoryExclusiveWithClient(racingClient, "/Protokolle/2026-08-14"),
    false,
  );
});

test("Protokolldateien werden ausschließlich ohne Überschreiben angelegt", async () => {
  let overwrite: unknown;
  let statCalls = 0;
  const existingClient = {
    putFileContents: async (_path: string, _content: unknown, options: { overwrite?: boolean }) => {
      overwrite = options.overwrite;
      return false;
    },
    stat: async () => {
      statCalls += 1;
      throw new Error("stat darf bei vorhandener Datei nicht laufen");
    },
  } as Parameters<typeof createWebDavTextExclusiveWithClient>[0];
  assert.deepEqual(
    await createWebDavTextExclusiveWithClient(
      existingClient,
      "/Protokolle/2026-08-14/Protokoll.md",
      "# Sitzung",
    ),
    { created: false },
  );
  assert.equal(overwrite, false);
  assert.equal(statCalls, 0);
});

test("WebDAV 409/412 wird als bearbeitbarer Versionskonflikt gemeldet", async () => {
  for (const status of [409, 412]) {
    const client = {
      customRequest: async () => {
        throw Object.assign(new Error("conflict"), { status });
      },
      stat: async () => {
        throw new Error("stat darf nach Konflikt nicht laufen");
      },
    } as Parameters<typeof writeWebDavTextIfMatchWithClient>[0];
    await assert.rejects(
      writeWebDavTextIfMatchWithClient(
        client,
        "/Protokolle/2026-08-14/Protokoll.md",
        "# Neu",
        '"etag-alt"',
      ),
      WebDavConflictError,
    );
  }
});
