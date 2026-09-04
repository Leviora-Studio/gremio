// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { exportProtocolPdf } from "../lib/protocol-export";
import type { ProtocolPdfRenderInput } from "../lib/protocol-pdf-renderer";
import type { ProtocolArea, ProtocolSession, User } from "../lib/db/schema";
import { WebDavPdfError } from "../lib/nextcloud";

after(async () => { await pool.end(); });
const user = { id: 1 } as User;
const area = { id: 2, rootPath: "/Protokolle" } as ProtocolArea;
const session = { id: 3, areaId: 2, folderName: "Sitzung", folderFileId: "folder-3", protocolPath: "/Protokolle/Sitzung/Protokoll.md", protocolFileId: "md-3" } as ProtocolSession;
type Deps = NonNullable<Parameters<typeof exportProtocolPdf>[5]>;
function setup() {
  const writes: { path: string; replace: boolean }[] = [];
  const renders: ProtocolPdfRenderInput[] = [];
  const source = '---\ntitle: "Aus der Datei"\nsitzungsleitung: "Anna"\n---\n# Protokoll\nText\n';
  const deps: Deps = {
    getProtocolAreaById: async id => id === 2 ? area : undefined,
    getProtocolSession: async (a, s) => a === 2 && s === 3 ? session : undefined,
    canAccessProtocolArea: async () => true,
    protocolCredentials: () => ({ url: "https://example.invalid", username: "unused", password: "test-secret" }),
    statWebDavEntry: async (_c, path) => ({ path, name: path.split("/").pop()!, type: path.endsWith("/Sitzung") ? "directory" : "file", fileId: path.endsWith("/Sitzung") ? "folder-3" : "md-3", size: 100, etag: "etag", mime: "text/markdown", lastModified: null }),
    readWebDavText: async () => ({ content: source, stat: await deps.statWebDavEntry({} as never, session.protocolPath!) }),
    readWebDavImage: async () => { throw new WebDavPdfError("not found", 404); },
    getProtocolLogos: async () => [{ id: 4, name: "A", isDefault: false }, { id: 5, name: "B", isDefault: true }],
    getProtocolLogoBytes: async (_a, id) => Buffer.from(`logo-${id}`),
    normalizeProtocolLogo: async bytes => Buffer.from(bytes),
    renderProtocolPdf: async input => { renders.push(input); return Buffer.from("%PDF-1.7"); },
    writeWebDavBinary: async (_c, path, _b, _m, replace) => { writes.push({ path, replace }); return true; },
  };
  return { deps, writes, renders, source };
}

test("PDF export uses persisted Markdown/YAML, default or selected area logo and exclusive PDF write", async () => {
  const { deps, writes, renders, source } = setup();
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "Protokoll.pdf", logoId: null }, deps)).success);
  assert.equal(renders[0].markdown, source);
  assert.equal(renders[0].sourceName, "Protokoll.md");
  assert.equal(renders[0].logo, Buffer.from("logo-5").toString("base64"));
  assert.deepEqual(writes, [{ path: "/Protokolle/Sitzung/Protokoll.pdf", replace: false }]);
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "Anderer Name.pdf", logoId: 4 }, deps)).success);
  assert.equal(renders[1].logo, Buffer.from("logo-4").toString("base64"));
});

test("export denies foreign logos/areas/sessions, invalid filenames, malformed YAML and collisions", async () => {
  const { deps, writes, renders } = setup();
  for (const filename of ["../x.pdf", "/x.pdf", "x\\y.pdf", ".secret.pdf", "x.md", "x\0.pdf", "x.pdf "]) assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename, logoId: 4 }, deps)).error);
  for (const [a, s, folder] of [[9, 3, "Sitzung"], [2, 9, "Sitzung"], [2, 3, "Anders"]] as const) assert.ok((await exportProtocolPdf(user, a, s, folder, { filename: "x.pdf", logoId: 4 }, deps)).error);
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 99 }, deps)).error);
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 4 }, { ...deps, canAccessProtocolArea: async () => false })).error);
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 4 }, { ...deps, readWebDavText: async () => ({ ...await deps.readWebDavText({} as never, ""), content: "---\ntitle: [\n---\n" }) })).error);
  assert.equal(writes.length, 0); assert.equal(renders.length, 0);
  assert.match((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 4 }, { ...deps, writeWebDavBinary: async () => false })).error!, /existiert bereits/);
});

test("export rechecks the session folder and hides external errors; no logo is supported", async () => {
  const { deps, writes, renders } = setup();
  let folderChecks = 0;
  const changed = { ...deps, statWebDavEntry: async (c: Parameters<Deps["statWebDavEntry"]>[0], path: string) => {
    const entry = await deps.statWebDavEntry(c, path);
    if (entry.type === "directory" && ++folderChecks === 2) entry.fileId = "replacement";
    return entry;
  } };
  assert.match((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 4 }, changed)).error!, /verändert/);
  assert.equal(writes.length, 0);
  assert.ok((await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: null }, { ...deps, getProtocolLogos: async () => [] })).success);
  assert.equal(renders.at(-1)?.logo, null);
  const failed = await exportProtocolPdf(user, 2, 3, "Sitzung", { filename: "x.pdf", logoId: 4 }, { ...deps, writeWebDavBinary: async () => { throw new Error("test-secret"); } });
  assert.ok(failed.error && !failed.error.includes("test-secret"));
});
