// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { MAX_UPLOAD_BYTES } from "../lib/constants";
import { readWebDavPdfWithClient, WebDavPdfError } from "../lib/nextcloud";
import { protocolPdfResponse } from "../lib/protocol-pdf";
import type { ProtocolArea, ProtocolSession, User } from "../lib/db/schema";

after(async () => { await pool.end(); });
const pdf = Buffer.from("%PDF-1.7\nTest\n%%EOF");
const file = { filename: "/Protokolle/Sitzung/Anlage.PDF", basename: "Anlage.PDF", type: "file", mime: "application/octet-stream", size: pdf.length };
type PdfClient = Parameters<typeof readWebDavPdfWithClient>[0];

test("WebDAV-PDF wird binär, schreibgeschützt und mit Zeitlimit geladen", async () => {
  const calls: string[] = [];
  let signal: AbortSignal | undefined;
  const client = {
    stat: async (path: string) => { calls.push(path); return file; },
    customRequest: async (path: string, options: { method: string; signal: AbortSignal }) => {
      calls.push(path); assert.equal(options.method, "GET"); signal = options.signal;
      assert.equal(signal.aborted, false);
      return new Response(pdf);
    },
  } as unknown as PdfClient;
  assert.deepEqual(await readWebDavPdfWithClient(client, file.filename), pdf);
  assert.deepEqual(calls, [file.filename, file.filename]);
  assert.equal(signal?.aborted, true);
});

test("PDF-Abruf weist Ordner, falsche Dateitypen und unechte PDF-Inhalte ab", async () => {
  for (const [stat, body, status] of [
    [{ ...file, type: "directory" }, pdf, 404],
    [{ ...file, basename: "Anlage.txt", mime: "text/plain" }, pdf, 415],
    [file, Buffer.from("<html>Keine PDF-Datei</html>"), 415],
    [file, Buffer.alloc(0), 415],
    [{ ...file, size: MAX_UPLOAD_BYTES + 1 }, pdf, 413],
  ] as const) {
    await assert.rejects(readWebDavPdfWithClient({ stat: async () => stat, customRequest: async () => new Response(body) } as unknown as PdfClient, file.filename), (error: unknown) => error instanceof WebDavPdfError && error.status === status);
  }
  const byMime = { stat: async () => ({ ...file, basename: "Anlage", mime: "application/pdf" }), customRequest: async () => new Response(pdf) } as unknown as PdfClient;
  assert.deepEqual(await readWebDavPdfWithClient(byMime, file.filename), pdf);
});

test("PDF-Größenlimit prüft auch Antwortheader und tatsächlich empfangene Bytes", async () => {
  const largeHeader = { stat: async () => file, customRequest: async () => new Response(pdf, { headers: { "Content-Length": String(MAX_UPLOAD_BYTES + 1) } }) } as unknown as PdfClient;
  await assert.rejects(readWebDavPdfWithClient(largeHeader, file.filename), (error: unknown) => error instanceof WebDavPdfError && error.status === 413);
  let cancelled = false;
  let count = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { count++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const lyingMetadata = { stat: async () => file, customRequest: async () => new Response(stream) } as unknown as PdfClient;
  await assert.rejects(readWebDavPdfWithClient(lyingMetadata, file.filename), (error: unknown) => error instanceof WebDavPdfError && error.status === 413);
  assert.equal(cancelled, true);
  assert.ok(count <= 27, "must stop consuming an oversized response");
});

test("PDF-Endpunkt prüft Anmeldung, Bereichsrechte, Sitzungszuordnung und Pfad vor Cloud-Abruf", async () => {
  const user = { id: 1 } as User;
  const area = { id: 2, rootPath: "/Protokolle" } as ProtocolArea;
  const session = { id: 3, areaId: 2, folderName: "Sitzung" } as ProtocolSession;
  let allowed = true;
  let reads = 0;
  const deps: NonNullable<Parameters<typeof protocolPdfResponse>[4]> = {
    getProtocolAreaById: async id => id === area.id ? area : undefined,
    canAccessProtocolArea: async () => allowed,
    getProtocolSession: async (areaId, sessionId) => areaId === 2 && sessionId === 3 ? session : undefined,
    protocolCredentials: () => ({ url: "https://example.invalid", username: "private-user", password: "private-password" }),
    readWebDavPdf: async (_creds, path) => { reads++; assert.equal(path, "/Protokolle/Sitzung/Anlage ü.PDF"); return pdf; },
  };
  assert.equal((await protocolPdfResponse(null, 2, 3, "Anlage.pdf", deps)).status, 401);
  allowed = false;
  assert.equal((await protocolPdfResponse(user, 2, 3, "Anlage.pdf", deps)).status, 404);
  allowed = true;
  for (const [areaId, sessionId] of [[2, 4], [4, 3], [NaN, 3], [2, -1]]) assert.equal((await protocolPdfResponse(user, areaId, sessionId, "Anlage.pdf", deps)).status, 404);
  for (const filename of ["", "../Secret.pdf", "Sub/Secret.pdf", "..", "Secret\\File.pdf", "x\0.pdf", " x.pdf", "__PATH_SEPARATOR_POSIX__Secret.pdf"]) {
    assert.equal((await protocolPdfResponse(user, 2, 3, filename, deps)).status, 400);
  }
  assert.equal(reads, 0);
  const response = await protocolPdfResponse(user, 2, 3, "Anlage ü.PDF", deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Disposition")!, /inline;.*filename\*=UTF-8''Anlage%20%C3%BC.PDF/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const failed = await protocolPdfResponse(user, 2, 3, "Anlage.pdf", { ...deps, readWebDavPdf: async () => { throw new Error("private-password https://private-url"); } });
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes("private-"));
  const nested = await protocolPdfResponse(user, 2, 3, { filename: "Anlage.pdf", subfolder: "Anlagen/Finanzen" }, { ...deps, readWebDavPdf: async (_creds, path) => { assert.equal(path, "/Protokolle/Sitzung/Anlagen/Finanzen/Anlage.pdf"); return pdf; } });
  assert.equal(nested.status, 200);
  const before = reads;
  for (const subfolder of ["../Andere Sitzung", "/Privat", "Anlagen/../../Privat"]) assert.equal((await protocolPdfResponse(user, 2, 3, { filename: "Anlage.pdf", subfolder }, deps)).status, 400);
  assert.equal(reads, before);
});
