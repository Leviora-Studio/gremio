// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { User } from "@/lib/db/schema";
import { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials } from "@/lib/protocols";
import { protocolDeletionPath } from "@/lib/protocol-deletion";
import { protocolFilePath } from "@/lib/protocol-paths";
import { MAX_MARKDOWN_BYTES, readWebDavText, overwriteWebDavText, statWebDavEntry } from "@/lib/nextcloud";

export type MarkdownTarget = { areaId: number; sessionId: number; filename: string; subfolder?: string; folderName?: string; fileId?: string | null; isProtocol?: boolean };
const dependencies = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, readWebDavText, overwriteWebDavText, statWebDavEntry };
export class MarkdownDocumentError extends Error {}
export const isMarkdownFilename = (name: string) => /\.(md|markdown)$/i.test(name);

/** A document stays within an authorized session, including validated subfolders. */
export async function resolveMarkdownDocument(user: User, target: MarkdownTarget, deps = dependencies) {
  if (!Number.isSafeInteger(target.areaId) || target.areaId < 1 || !Number.isSafeInteger(target.sessionId) || target.sessionId < 1 || typeof target.filename !== "string" || !isMarkdownFilename(target.filename) || Buffer.byteLength(target.filename) > 255) throw new MarkdownDocumentError("Ungültige Markdown-Datei.");
  const area = await deps.getProtocolAreaById(target.areaId);
  if (!area || !(await deps.canAccessProtocolArea(user, area))) throw new MarkdownDocumentError("Kein Zugriff auf diesen Protokollbereich.");
  const session = await deps.getProtocolSession(target.areaId, target.sessionId);
  if (!session || (target.folderName !== undefined && target.folderName !== session.folderName)) throw new MarkdownDocumentError("Sitzung nicht gefunden oder umbenannt. Bitte den Ordner erneut öffnen.");
  let path: string;
  try { path = protocolFilePath(area.rootPath, session.folderName, target.filename, target.subfolder); }
  catch { throw new MarkdownDocumentError("Ungültiger Datei- oder Unterordnername."); }
  const creds = deps.protocolCredentials(area);
  const folder = await deps.statWebDavEntry(creds, protocolDeletionPath(area.rootPath, session.folderName));
  if (folder.type !== "directory" || (session.folderFileId && folder.fileId !== session.folderFileId)) throw new MarkdownDocumentError("Der Sitzungsordner wurde ersetzt oder verschoben.");
  const file = await deps.statWebDavEntry(creds, path);
  if (file.type !== "file" || (target.fileId && file.fileId !== target.fileId)) throw new MarkdownDocumentError("Die Datei wurde ersetzt oder verschoben. Bitte den Ordner erneut öffnen.");
  if (file.size > MAX_MARKDOWN_BYTES) throw new MarkdownDocumentError("Markdown-Dateien dürfen höchstens 2 MB groß sein.");
  const isProtocol = session.protocolPath === path;
  if (isProtocol && session.protocolFileId && file.fileId !== session.protocolFileId) throw new MarkdownDocumentError("Die registrierte Protokolldatei wurde ersetzt. Bitte den Ordner synchronisieren.");
  if (target.isProtocol !== undefined && target.isProtocol !== isProtocol) throw new MarkdownDocumentError("Die Protokollzuordnung hat sich geändert. Bitte den Editor erneut öffnen.");
  return { area, session, file, path, creds, isProtocol };
}

export async function readMarkdownDocument(user: User, target: MarkdownTarget, deps = dependencies) {
  const context = await resolveMarkdownDocument(user, target, deps);
  const source = await deps.readWebDavText(context.creds, context.path);
  if (context.file.fileId && source.stat.fileId && context.file.fileId !== source.stat.fileId) throw new MarkdownDocumentError("Die Datei wurde während des Ladens ersetzt.");
  return { ...context, content: source.content };
}

/** Generic Markdown never invokes attendance or finance reconciliation. */
export async function saveMarkdownDocument(user: User, target: MarkdownTarget, content: string, deps = dependencies) {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) throw new MarkdownDocumentError("Markdown-Dateien dürfen höchstens 2 MB groß sein.");
  const context = await resolveMarkdownDocument(user, target, deps);
  if (context.isProtocol) throw new MarkdownDocumentError("Protokolle müssen über die Protokollfunktionen gespeichert werden.");
  await deps.overwriteWebDavText(context.creds, context.path, content);
  return { savedToNextcloud: true, content, success: "In Nextcloud gespeichert." };
}
