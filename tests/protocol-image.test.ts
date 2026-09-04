// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { MAX_UPLOAD_BYTES } from "../lib/constants";
import { readWebDavImageWithClient, WebDavPdfError } from "../lib/nextcloud";
import { protocolImageResponse } from "../lib/protocol-pdf";
import { protocolImageMime, detectProtocolImageMime } from "../lib/protocol-image";
import type { ProtocolArea, ProtocolSession, User } from "../lib/db/schema";

after(async () => { await pool.end(); });
const file = { filename: "/Sitzung/Foto.png", basename: "Foto.png", type: "file", mime: "application/octet-stream", size: 10 };
type Client = Parameters<typeof readWebDavImageWithClient>[0];

test("Bildvorschau erkennt PNG, JPEG, GIF und WebP anhand Dateityp und Dateikennung", async () => {
  const formats = [
    ["Foto.PNG", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ["Foto.jpeg", "image/jpeg", Buffer.from([255, 216, 255, 224])],
    ["Animation.gif", "image/gif", Buffer.from("GIF89a")],
    ["Foto.webp", "image/webp", Buffer.from("RIFF1234WEBP")],
  ] as const;
  for (const [name, mime, bytes] of formats) {
    assert.equal(protocolImageMime(name, "application/octet-stream"), mime);
    assert.equal(protocolImageMime("no-extension", `${mime}; charset=binary`), mime);
    assert.equal(detectProtocolImageMime(bytes), mime);
    const client = { stat: async () => ({ ...file, basename: name, size: bytes.length }), customRequest: async () => new Response(bytes) } as unknown as Client;
    const result = await readWebDavImageWithClient(client, "/Sitzung/Foto");
    assert.equal(result.mime, mime); assert.deepEqual(result.bytes, bytes);
  }
  for (const filename of ["x.svg", "x.html", "x.constructor", "x.__proto__"]) assert.equal(protocolImageMime(filename, null), null);
});

test("Bildabruf weist aktive Inhalte, Ordner und zu große Bilder ab", async () => {
  for (const [stat, bytes, status] of [
    [file, Buffer.from('<svg onload="alert(1)"/>'), 415],
    [{ ...file, basename: "Foto.jpg", mime: "image/jpeg" }, Buffer.from("<html>wrong image</html>"), 415],
    [{ ...file, type: "directory" }, Buffer.alloc(0), 404],
    [{ ...file, size: MAX_UPLOAD_BYTES + 1 }, Buffer.alloc(0), 413],
    [{ ...file, basename: "Foto.svg", mime: "image/svg+xml" }, Buffer.from("<svg/>"), 415],
  ] as const) {
    const client = { stat: async () => stat, customRequest: async () => new Response(bytes) } as unknown as Client;
    await assert.rejects(readWebDavImageWithClient(client, "/Sitzung/Foto"), (error: unknown) => error instanceof WebDavPdfError && error.status === status);
  }
});

test("Bild-Endpunkt verwendet Bereichsrechte, Sitzungspfade und private Antwortheader", async () => {
  let reads = 0;
  const bytes = Buffer.from([255, 216, 255, 224]);
  const deps: NonNullable<Parameters<typeof protocolImageResponse>[4]> = {
    getProtocolAreaById: async id => id === 2 ? { id, rootPath: "/Protokolle" } as ProtocolArea : undefined,
    canAccessProtocolArea: async user => user.id === 1,
    getProtocolSession: async (areaId, sessionId) => areaId === 2 && sessionId === 3 ? { id: 3, folderName: "Sitzung" } as ProtocolSession : undefined,
    protocolCredentials: () => ({ url: "https://example.invalid", username: "unused", password: "unused" }),
    readWebDavImage: async (_creds, path) => { reads++; assert.equal(path, "/Protokolle/Sitzung/Foto ä.jpg"); return { bytes, mime: "image/jpeg" }; },
  };
  const user = { id: 1 } as User;
  assert.equal((await protocolImageResponse(null, 2, 3, "Foto ä.jpg", deps)).status, 401);
  assert.equal((await protocolImageResponse({ id: 9 } as User, 2, 3, "Foto ä.jpg", deps)).status, 404);
  assert.equal((await protocolImageResponse(user, 2, 4, "Foto ä.jpg", deps)).status, 404);
  assert.equal((await protocolImageResponse(user, 2, 3, "../Foto.jpg", deps)).status, 400);
  assert.equal(reads, 0);
  const result = await protocolImageResponse(user, 2, 3, "Foto ä.jpg", deps);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Content-Type"), "image/jpeg");
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.equal(result.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(result.headers.get("Content-Disposition")!, /inline;.*Foto%20%C3%A4.jpg/);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  const nested = await protocolImageResponse(user, 2, 3, { filename: "Foto.jpg", subfolder: "Anlagen/Bilder" }, { ...deps, readWebDavImage: async (_creds, path) => { assert.equal(path, "/Protokolle/Sitzung/Anlagen/Bilder/Foto.jpg"); return { bytes, mime: "image/jpeg" }; } });
  assert.equal(nested.status, 200);
  const before = reads;
  for (const subfolder of ["../Andere Sitzung", "/Privat", "Anlagen/../../Privat"]) assert.equal((await protocolImageResponse(user, 2, 3, { filename: "Foto.jpg", subfolder }, deps)).status, 400);
  assert.equal(reads, before);
});
