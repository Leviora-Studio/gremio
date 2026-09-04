// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWebDavDirectoryExclusiveWithClient,
  createWebDavTextExclusiveWithClient,
  joinWebDavPath,
  nextcloudBrowserUrl,
  overwriteWebDavTextWithClient,
} from "../lib/nextcloud";

test("Speichern überschreibt den Cloud-Inhalt ohne Versionsbedingung", async () => {
  const path = "/Protokolle/2026-08-14/Protokoll.md";
  const content = "# Änderungen aus Gremio";
  let cloudContent = "# Zwischenzeitlich in Nextcloud geändert";
  const calls: string[] = [];
  const client = {
    customRequest: async (target: string, options: { method: string; headers: Record<string, string>; data: string }) => {
      calls.push("PUT");
      assert.equal(target, path);
      assert.equal(options.method, "PUT");
      assert.deepEqual(options.headers, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(content)),
      }, "Kein If-Match, If-Unmodified-Since oder If-None-Match beim Speichern");
      cloudContent = options.data;
      return {};
    },
    stat: async (target: string) => {
      calls.push("stat");
      assert.equal(target, path);
      return {
        filename: path,
        basename: "Protokoll.md",
        type: "file",
        etag: '"etag-nach-speichern"',
        size: Buffer.byteLength(cloudContent),
        lastmod: "Fri, 14 Aug 2026 12:00:00 GMT",
      };
    },
  } as unknown as Parameters<typeof overwriteWebDavTextWithClient>[0];

  // Weder ein alter noch überhaupt ein bekannter Versionsstand wird benötigt.
  const result = await overwriteWebDavTextWithClient(client, path, content);
  assert.equal(cloudContent, content);
  assert.equal(result.etag, '"etag-nach-speichern"');
  assert.deepEqual(calls, ["PUT", "stat"]);
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

test("empty Markdown files can be created without weakening exclusive writes", async () => {
  const path = "/Protokolle/Sitzung/Anlagen/Notizen.md";
  const client = {
    putFileContents: async (requestedPath: string, content: unknown, options: { overwrite?: boolean }) => {
      assert.equal(requestedPath, path); assert.equal(content, ""); assert.equal(options.overwrite, false);
      return true;
    },
    stat: async () => ({ filename: path, basename: "Notizen.md", type: "file", size: 0, etag: "new-file", lastmod: "2026-09-04T12:00:00Z" }),
  } as Parameters<typeof createWebDavTextExclusiveWithClient>[0];
  const result = await createWebDavTextExclusiveWithClient(client, path, "");
  assert.equal(result.created, true);
  assert.equal(result.stat?.size, 0);
});

test("WebDAV-Fehler bleiben beim Überschreiben sichtbar und werden nicht als Erfolg behandelt", async () => {
  for (const status of [403, 409, 412, 423, 500]) {
    const failure = Object.assign(new Error(`WebDAV ${status}`), { status });
    const client = {
      customRequest: async () => {
        throw failure;
      },
      stat: async () => {
        assert.fail("stat darf nach fehlgeschlagenem PUT nicht laufen");
      },
    } as Parameters<typeof overwriteWebDavTextWithClient>[0];
    await assert.rejects(
      overwriteWebDavTextWithClient(
        client,
        "/Protokolle/2026-08-14/Protokoll.md",
        "# Neu",
      ),
      (error) => error === failure,
    );
  }
});

test("auch überschreibendes Speichern hält das Größenlimit ein", async () => {
  const client = {
    customRequest: async () => assert.fail("Übergroße Dateien dürfen nicht gesendet werden"),
    stat: async () => assert.fail("Kein Metadatenzugriff bei ungültiger Eingabe"),
  } as Parameters<typeof overwriteWebDavTextWithClient>[0];
  await assert.rejects(
    overwriteWebDavTextWithClient(client, "/Protokoll.md", "x".repeat(2_000_001)),
    /höchstens 2 MB/,
  );
});
