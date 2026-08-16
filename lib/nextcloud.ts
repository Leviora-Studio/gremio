// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { createClient, getPatcher, type WebDAVClient } from "webdav";
import { fetch as nodeFetch } from "@buttercup/fetch";
import { absPath } from "@/lib/attachments";
import { isSafeExternalUrl, isPublicHost } from "@/lib/url-guard";

export interface NcCredentials {
  url: string;
  username: string;
  password: string;
}

/** Schnelle Vorab-Prüfung der konfigurierten URL (Schema + Literal-Host + TLS). */
function assertSafeNcUrl(rawUrl: string): void {
  if (!isSafeExternalUrl(rawUrl)) {
    throw new Error(
      "Nextcloud-URL ist nicht erlaubt (nur öffentliche http(s)-Hosts).",
    );
  }
  // Zugangsdaten gehen per Basic-Auth an diese URL → nur über TLS zulassen,
  // sonst lägen Benutzername/Passwort im Klartext auf der Leitung.
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Nextcloud-URL ist ungültig.");
  }
  if (u.protocol !== "https:") {
    throw new Error(
      "Nextcloud-URL muss mit https:// beginnen (Zugangsdaten dürfen nicht unverschlüsselt über http gesendet werden).",
    );
  }
}

/**
 * SSRF-Kern-Schutz (Hostnamen): ein DNS-Lookup, der die aufgelöste IP prüft UND
 * die Verbindung exakt darauf pinnt → schützt gegen DNS-Rebinding (TOCTOU).
 * Greift NUR bei Hostnamen; IP-Literale und Redirects deckt der Redirect-Guard
 * (installRedirectGuard) ab.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function guardedLookup(hostname: string, options: any, cb: any): void {
  dnsLookup(hostname, options, (err: any, address: any, family: any) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? address : [{ address, family }];
    for (const a of list) {
      if (!isPublicHost(a.address)) {
        return cb(new Error(`SSRF-Schutz: ${a.address} ist intern/privat.`));
      }
    }
    cb(null, address, family);
  });
}
const guardedHttpAgent = new HttpAgent({ lookup: guardedLookup } as any);
const guardedHttpsAgent = new HttpsAgent({ lookup: guardedLookup } as any);

/**
 * Redirect-Schutz: Der DNS-`lookup`-Guard oben greift NUR bei Hostnamen — bei
 * IP-Literalen (z.B. http://127.0.0.1/) ruft Node keinen DNS-Lookup auf, der
 * Guard liefe ins Leere. node-fetch (vom webdav-Client genutzt) würde 3xx-Ziele
 * sonst automatisch über denselben Agent weiterverfolgen → ein externer Host
 * könnte per Redirect auf eine interne IP zeigen (SSRF). Deshalb: webdav-fetch
 * global so patchen, dass (a) jede Ziel-URL erneut geprüft wird und (b) jeder
 * Redirect HART fehlschlägt (redirect:"error" → kein zweiter Request).
 */
let redirectGuardInstalled = false;
function installRedirectGuard(): void {
  if (redirectGuardInstalled) return;
  redirectGuardInstalled = true;
  getPatcher().patch("fetch", ((url: unknown, opts: any) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      return Promise.reject(new Error("SSRF-Schutz: Ziel-URL nicht erlaubt."));
    }
    return nodeFetch(url, { ...opts, redirect: "error" });
  }) as any);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function client(creds: NcCredentials): WebDAVClient {
  installRedirectGuard();
  return createClient(creds.url, {
    username: creds.username,
    password: creds.password,
    httpAgent: guardedHttpAgent,
    httpsAgent: guardedHttpsAgent,
  });
}

/** Dateinamen/Pfadteile für WebDAV säubern (inkl. Path-Traversal-Schutz). */
export function sanitizeSegment(s: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\.{2,}/g, "_") // ".." / "..." → kein Verzeichnis-Ausbruch
    .replace(/^\.+/, "") // führende Punkte (versteckte Pfade) entfernen
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "ordner";
}

function normalizeBase(folder: string): string {
  let f = folder.trim();
  if (!f.startsWith("/")) f = "/" + f;
  if (f.endsWith("/")) f = f.slice(0, -1);
  return f;
}

async function ensureDir(c: WebDAVClient, path: string): Promise<void> {
  if (!(await c.exists(path))) {
    await c.createDirectory(path, { recursive: true });
  }
}

/** Verbindung testen (Verzeichnisinhalt des Zielordners lesen). */
export async function testConnection(
  creds: NcCredentials,
  targetFolder: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    assertSafeNcUrl(creds.url);
    const c = client(creds);
    const base = normalizeBase(targetFolder);
    // Existenz des Wurzelpfads prüfen (legt Zielordner ggf. an).
    await ensureDir(c, base);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Alle Dateien eines Antrags in einen Unterordner des Zielordners hochladen. */
export async function uploadAntragArchive(opts: {
  creds: NcCredentials;
  targetFolder: string;
  subfolder: string;
  files: { relPath: string; filename: string }[];
}): Promise<string> {
  assertSafeNcUrl(opts.creds.url);
  const c = client(opts.creds);
  const base = normalizeBase(opts.targetFolder);
  await ensureDir(c, base);
  const folder = `${base}/${sanitizeSegment(opts.subfolder)}`;
  await ensureDir(c, folder);

  for (const f of opts.files) {
    const buf = await readFile(absPath(f.relPath));
    await c.putFileContents(`${folder}/${sanitizeSegment(f.filename)}`, buf, {
      overwrite: true,
    });
  }
  return folder;
}
