// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import {
  createClient,
  getPatcher,
  type FileStat,
  type WebDAVClient,
} from "webdav";
import { fetch as nodeFetch } from "@buttercup/fetch";
import { absPath } from "@/lib/attachments";
import { isSafeExternalUrl, isPublicHost } from "@/lib/url-guard";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { detectProtocolImageMime, protocolImageMime } from "@/lib/protocol-image";

export interface NcCredentials {
  url: string;
  username: string;
  password: string;
}

export const MAX_MARKDOWN_BYTES = 2_000_000;

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

export type WebDavEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  etag: string | null;
  fileId: string | null;
  mime: string | null;
  size: number;
  lastModified: string | null;
};

function fileId(stat: FileStat): string | null {
  const props = (stat.props ?? {}) as Record<string, unknown>;
  for (const key of ["oc:fileid", "fileid", "{http://owncloud.org/ns}fileid"]) {
    const value = props[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return null;
}

function entry(stat: FileStat): WebDavEntry {
  return {
    path: stat.filename,
    name: stat.basename,
    type: stat.type,
    etag: stat.etag,
    fileId: fileId(stat),
    mime: stat.mime ?? null,
    size: stat.size,
    lastModified: stat.lastmod || null,
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function nextcloudFileIds(
  c: Pick<WebDAVClient, "customRequest">,
  folder: string,
  depth: "0" | "1" = "1",
): Promise<Map<string, string>> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
    <d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
      <d:prop><d:displayname/><oc:fileid/></d:prop>
    </d:propfind>`;
  try {
    const response = await c.customRequest(normalizeBase(folder), {
      method: "PROPFIND",
      headers: {
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      data: body,
    });
    const xml = await response.text();
    const ids = new Map<string, string>();
    for (const block of xml.matchAll(/<(?:d:)?response\b[\s\S]*?<\/(?:d:)?response>/gi)) {
      const href = /<(?:d:)?href\b[^>]*>([\s\S]*?)<\/(?:d:)?href>/i.exec(block[0])?.[1];
      const id = /<(?:oc:)?fileid\b[^>]*>([^<]+)<\/(?:oc:)?fileid>/i.exec(block[0])?.[1];
      if (!href || !id) continue;
      const pathname = decodeURIComponent(decodeXml(href)).replace(/\/$/, "");
      const name = pathname.split("/").pop();
      if (name) ids.set(name, decodeXml(id).trim());
    }
    return ids;
  } catch {
    // Nicht-Nextcloud-WebDAV-Server unterstützen oc:fileid ggf. nicht. ETag +
    // Pfad bleiben dann der dokumentierte Fallback.
    return new Map();
  }
}

export function joinWebDavPath(...segments: string[]): string {
  const clean = segments
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? normalizeBase(part) : part.replace(/^\/+|\/+$/g, ""),
    );
  return clean.join("/").replace(/\/{2,}/g, "/");
}

/** Verzeichnisinhalt lesen; Zugangsdaten bleiben vollständig serverseitig. */
export async function listWebDavDirectory(
  creds: NcCredentials,
  folder: string,
): Promise<WebDavEntry[]> {
  assertSafeNcUrl(creds.url);
  const c = client(creds);
  const normalized = normalizeBase(folder);
  const [rows, ids] = await Promise.all([
    c.getDirectoryContents(normalized),
    nextcloudFileIds(c, normalized),
  ]);
  return rows.map((row) => ({ ...entry(row), fileId: fileId(row) ?? ids.get(row.basename) ?? null }));
}

export async function statWebDavEntry(
  creds: NcCredentials,
  path: string,
): Promise<WebDavEntry> {
  assertSafeNcUrl(creds.url);
  return statWebDavEntryWithClient(client(creds), path);
}

export async function statWebDavEntryWithClient(c: Pick<WebDAVClient, "stat" | "customRequest">, path: string): Promise<WebDavEntry> {
  const normalized = normalizeBase(path);
  const result = entry((await c.stat(normalized)) as FileStat);
  // Nextcloud does not always include oc:fileid in the standard stat response.
  if (!result.fileId) result.fileId = (await nextcloudFileIds(c, normalized, "0")).get(result.name) ?? null;
  return result;
}

export async function readWebDavText(
  creds: NcCredentials,
  path: string,
): Promise<{ content: string; stat: WebDavEntry }> {
  assertSafeNcUrl(creds.url);
  return readWebDavTextWithClient(client(creds), path);
}

/** Bound the actual response, including chunked bodies and changing metadata. */
export async function readWebDavTextWithClient(
  c: Pick<WebDAVClient, "stat" | "customRequest">,
  path: string,
): Promise<{ content: string; stat: WebDavEntry }> {
  const normalized = normalizeBase(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const tooLarge = () => new Error("Die Markdown-Datei ist größer als 2 MB und kann nicht in Gremio bearbeitet werden.");
  try {
    const fileStat = await c.stat(normalized, { signal: controller.signal }) as FileStat;
    if (fileStat.type !== "file") throw new Error("Keine Markdown-Datei gefunden.");
    if (fileStat.size > MAX_MARKDOWN_BYTES) throw tooLarge();
    const response = await c.customRequest(normalized, { method: "GET", signal: controller.signal });
    if (Number(response.headers.get("content-length")) > MAX_MARKDOWN_BYTES) throw tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_MARKDOWN_BYTES) throw tooLarge();
      chunks.push(Buffer.from(chunk));
    }
    return { content: Buffer.concat(chunks, size).toString("utf8"), stat: entry(fileStat) };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export class WebDavPdfError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Binary uploads are exclusive; PDF edits explicitly replace their original. */
export async function writeWebDavBinary(creds: NcCredentials, path: string, bytes: Buffer, mime: string, replace: boolean): Promise<boolean> {
  assertSafeNcUrl(creds.url);
  return writeWebDavBinaryWithClient(client(creds), path, bytes, mime, replace);
}

export async function writeWebDavBinaryWithClient(
  c: Pick<WebDAVClient, "customRequest">, path: string, bytes: Buffer, mime: string, replace: boolean,
): Promise<boolean> {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("Dateien müssen zwischen 1 Byte und 25 MB groß sein.");
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) throw new Error("Ungültiger Dateityp.");
  try {
    await c.customRequest(normalizeBase(path), {
      method: "PUT",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        ...(!replace ? { "If-None-Match": "*" } : {}),
      },
      data: bytes,
    });
    return true;
  } catch (error) {
    if (!replace && (error as { status?: number })?.status === 412) return false;
    throw error;
  }
}

/** Read-only PDF proxy; the existing guarded client keeps credentials server-side. */
export async function readWebDavPdf(creds: NcCredentials, path: string): Promise<Buffer> {
  assertSafeNcUrl(creds.url);
  return readWebDavPdfWithClient(client(creds), path);
}

export async function readWebDavPdfWithClient(
  c: Pick<WebDAVClient, "stat" | "customRequest">,
  path: string,
): Promise<Buffer> {
  return (await readWebDavMediaWithClient(c, path, "pdf")).bytes;
}

export async function readWebDavImage(creds: NcCredentials, path: string): Promise<{ bytes: Buffer; mime: string }> {
  assertSafeNcUrl(creds.url);
  return readWebDavImageWithClient(client(creds), path);
}

export async function readWebDavImageWithClient(c: Pick<WebDAVClient, "stat" | "customRequest">, path: string): Promise<{ bytes: Buffer; mime: string }> {
  return readWebDavMediaWithClient(c, path, "image");
}

async function readWebDavMediaWithClient(c: Pick<WebDAVClient, "stat" | "customRequest">, path: string, kind: "pdf" | "image"): Promise<{ bytes: Buffer; mime: string }> {
  const normalized = normalizeBase(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const stat = await c.stat(normalized, { signal: controller.signal }) as FileStat;
    if (stat.type !== "file") throw new WebDavPdfError("Datei nicht gefunden.", 404);
    if (kind === "pdf" && stat.mime?.split(";")[0].trim().toLowerCase() !== "application/pdf" && !/\.pdf$/i.test(stat.basename)) {
      throw new WebDavPdfError("Diese Datei ist keine PDF-Datei.", 415);
    }
    if (kind === "image" && !protocolImageMime(stat.basename, stat.mime ?? null)) throw new WebDavPdfError("Dieses Bildformat wird nicht unterstützt.", 415);
    const tooLarge = () => new WebDavPdfError("Dateien können bis zu 25 MB in Gremio angezeigt werden.", 413);
    if (stat.size > MAX_UPLOAD_BYTES) throw tooLarge();
    const response = await c.customRequest(normalized, { method: "GET", signal: controller.signal });
    if (Number(response.headers.get("content-length")) > MAX_UPLOAD_BYTES) throw tooLarge();
    if (!response.body) throw new WebDavPdfError("Die Datei ist leer.", 415);
    const chunks: Buffer[] = [];
    let size = 0;
    // node-fetch supplies a Node readable; count actual bytes even if metadata lies.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_UPLOAD_BYTES) throw tooLarge();
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks, size);
    if (kind === "image") {
      const mime = detectProtocolImageMime(bytes);
      if (!mime) throw new WebDavPdfError("Diese Datei enthält kein unterstütztes Bild.", 415);
      return { bytes, mime };
    }
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      throw new WebDavPdfError("Diese Datei enthält kein gültiges PDF-Dokument.", 415);
    }
    return { bytes, mime: "application/pdf" };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** Legt einen Ordner nur dann an, wenn er noch nicht existiert. */
export async function createWebDavDirectoryExclusive(
  creds: NcCredentials,
  path: string,
): Promise<boolean> {
  assertSafeNcUrl(creds.url);
  const c = client(creds);
  const normalized = normalizeBase(path);
  return createWebDavDirectoryExclusiveWithClient(c, normalized);
}

/** Separater Kern für deterministische Tests ohne echte Nextcloud-Verbindung. */
export async function createWebDavDirectoryExclusiveWithClient(
  c: Pick<WebDAVClient, "exists" | "createDirectory">,
  normalizedPath: string,
): Promise<boolean> {
  const normalized = normalizeBase(normalizedPath);
  if (await c.exists(normalized)) return false;
  try {
    await c.createDirectory(normalized, { recursive: false });
    return true;
  } catch (error) {
    if (await c.exists(normalized)) return false;
    throw error;
  }
}

/** PUT mit If-None-Match: *, damit bestehende Dateien nie überschrieben werden. */
export async function createWebDavTextExclusive(
  creds: NcCredentials,
  path: string,
  content: string,
): Promise<{ created: boolean; stat?: WebDavEntry }> {
  assertSafeNcUrl(creds.url);
  const c = client(creds);
  const normalized = normalizeBase(path);
  return createWebDavTextExclusiveWithClient(c, normalized, content);
}

/** Separater Kern für den Schutz vor Überschreiben und dessen Regressionstests. */
export async function createWebDavTextExclusiveWithClient(
  c: Pick<WebDAVClient, "putFileContents" | "stat">,
  normalizedPath: string,
  content: string,
): Promise<{ created: boolean; stat?: WebDavEntry }> {
  const normalized = normalizeBase(normalizedPath);
  if (Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) {
    throw new Error("Die Markdown-Datei darf höchstens 2 MB groß sein.");
  }
  const created = await c.putFileContents(normalized, content, {
    overwrite: false,
  });
  if (!created) return { created: false };
  return { created: true, stat: entry((await c.stat(normalized)) as FileStat) };
}

/** Überschreibt die Protokolldatei bewusst ohne ETag-/Versionsbedingung. */
export async function overwriteWebDavText(
  creds: NcCredentials,
  path: string,
  content: string,
): Promise<WebDavEntry> {
  assertSafeNcUrl(creds.url);
  const c = client(creds);
  const normalized = normalizeBase(path);
  return overwriteWebDavTextWithClient(c, normalized, content);
}

/** Separater Kern für Überschreib- und Fehlerfalltests ohne Netzwerk. */
export async function overwriteWebDavTextWithClient(
  c: Pick<WebDAVClient, "customRequest" | "stat">,
  normalizedPath: string,
  content: string,
): Promise<WebDavEntry> {
  const normalized = normalizeBase(normalizedPath);
  if (Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) {
    throw new Error("Die Markdown-Datei darf höchstens 2 MB groß sein.");
  }
  await c.customRequest(normalized, {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(content)),
    },
    data: content,
  });
  return entry((await c.stat(normalized)) as FileStat);
}

/** Explizites Löschen eines zuvor aufgelösten Ziels; Collections löscht WebDAV rekursiv. */
export async function deleteWebDavEntry(
  creds: NcCredentials,
  path: string,
  etag: string | null,
): Promise<void> {
  assertSafeNcUrl(creds.url);
  await deleteWebDavEntryWithClient(client(creds), path, etag);
}

export async function deleteWebDavEntryWithClient(
  c: Pick<WebDAVClient, "deleteFile">,
  path: string,
  etag: string | null,
): Promise<void> {
  const normalized = normalizeBase(path);
  if (!normalized || normalized === "/") throw new Error("Der WebDAV-Wurzelordner darf nicht gelöscht werden.");
  if (normalized.split("/").some((part) => part === "." || part === "..") || /[\\\x00-\x1f\x7f]|__PATH_SEPARATOR_(?:POSIX|WINDOWS)__/.test(normalized)) {
    throw new Error("Unsicheres WebDAV-Löschziel.");
  }
  // Die Bibliothek liefert ETags teilweise ohne Anführungszeichen. Für DELETE
  // schützen korrekt formatierte starke ETags vor Änderungen seit der Zielprüfung.
  const tag = etag?.trim();
  const headers: Record<string, string> = {};
  if (tag && !tag.startsWith("W/")) {
    if (/[\r\n]/.test(tag)) throw new Error("Ungültiger WebDAV-ETag.");
    headers["If-Match"] = tag.startsWith('"') ? tag : `"${tag}"`;
  }
  try {
    await c.deleteFile(normalized, { headers });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) return; // Wiederholbare Nachbearbeitung nach erfolgreichem DELETE.
    if (status === 412) throw new Error("Das Löschziel wurde zwischenzeitlich geändert. Bitte neu laden und erneut prüfen.");
    throw error;
  }
}

/** Browser-Link ohne Zugangsdaten. Mit fileId nutzt Nextcloud den stabilen /f/-Link. */
export function nextcloudBrowserUrl(
  webDavUrl: string,
  path: string,
  stableFileId?: string | null,
  isDirectory = false,
): string {
  const webDav = new URL(webDavUrl);
  const marker = webDav.pathname.indexOf("/remote.php/");
  const basePath = marker >= 0 ? webDav.pathname.slice(0, marker) : "";
  const base = `${webDav.origin}${basePath}`;
  if (stableFileId && /^\d+$/.test(stableFileId)) {
    return `${base}/f/${encodeURIComponent(stableFileId)}`;
  }
  const url = new URL(`${base}/index.php/apps/files/`);
  const normalized = normalizeBase(path);
  const directory = isDirectory
    ? normalized
    : normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  url.searchParams.set("dir", directory);
  return url.toString();
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
