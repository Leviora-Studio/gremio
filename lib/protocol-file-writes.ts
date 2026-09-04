// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { User } from "@/lib/db/schema";
import type { SavePdfInput, SavePdfResult } from "@/app/intern/card/[id]/pdf-actions";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { protocolDeletionPath } from "@/lib/protocol-deletion";
import { protocolDirectoryPath, protocolFilePath } from "@/lib/protocol-paths";
import { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials } from "@/lib/protocols";
import { createWebDavTextExclusive, readWebDavPdf, statWebDavEntry, writeWebDavBinary, WebDavPdfError } from "@/lib/nextcloud";
import { applyEditsAndSign } from "@/lib/pdf-apply";

const dependencies = { canAccessProtocolArea, getProtocolAreaById, getProtocolSession, protocolCredentials, statWebDavEntry, readWebDavPdf, writeWebDavBinary, applyEditsAndSign };
type Dependencies = typeof dependencies;
export type ProtocolUploadState = { error?: string; success?: string };
export type ProtocolMarkdownCreateState = { error?: string; filename?: string; href?: string };
class FileWriteError extends Error {}
type FolderTarget = string | { folderName: string; subfolder?: string };

async function target(user: User, areaId: number, sessionId: number, location: FolderTarget, filename: string, deps: Dependencies) {
  const { folderName, subfolder = "" } = typeof location === "string" ? { folderName: location } : location;
  if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(sessionId) || sessionId < 1) throw new FileWriteError("Ungültige Sitzung.");
  const area = await deps.getProtocolAreaById(areaId);
  if (!area || !(await deps.canAccessProtocolArea(user, area))) throw new FileWriteError("Kein Zugriff auf diesen Protokollbereich.");
  const session = await deps.getProtocolSession(areaId, sessionId);
  if (!session || session.folderName !== folderName) throw new FileWriteError("Sitzung nicht gefunden oder umbenannt. Bitte neu laden.");
  let path: string;
  let folderPath: string;
  try {
    if (typeof filename !== "string" || filename.startsWith(".") || Buffer.byteLength(filename) > 255) throw new Error();
    path = protocolFilePath(area.rootPath, session.folderName, filename, subfolder);
    folderPath = protocolDirectoryPath(area.rootPath, session.folderName, subfolder);
  } catch { throw new FileWriteError("Ungültiger Dateiname. Bitte einen einfachen Dateinamen ohne Pfad wählen."); }
  const creds = deps.protocolCredentials(area);
  const folder = await deps.statWebDavEntry(creds, protocolDeletionPath(area.rootPath, session.folderName));
  if (folder.type !== "directory" || (session.folderFileId && folder.fileId !== session.folderFileId)) throw new FileWriteError("Der Sitzungsordner wurde verändert. Bitte neu laden.");
  if (subfolder && (await deps.statWebDavEntry(creds, folderPath)).type !== "directory") throw new FileWriteError("Der Unterordner ist nicht mehr verfügbar. Bitte neu laden.");
  return { path, creds };
}

function message(error: unknown): string {
  return error instanceof FileWriteError || error instanceof WebDavPdfError
    ? error.message : "Nextcloud konnte den Vorgang nicht bestätigen. Bitte die Dateiliste prüfen, bevor du es erneut versuchst.";
}

export async function uploadProtocolFile(user: User, areaId: number, sessionId: number, folderName: FolderTarget, file: File, deps = dependencies): Promise<ProtocolUploadState> {
  try {
    if (!(file instanceof File) || !file.name || file.size === 0) throw new FileWriteError("Bitte eine nicht leere Datei auswählen.");
    if (file.size > MAX_UPLOAD_BYTES) throw new FileWriteError("Die Datei darf höchstens 25 MB groß sein.");
    const { path, creds } = await target(user, areaId, sessionId, folderName, file.name, deps);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.type) ? file.type : "application/octet-stream";
    if (!(await deps.writeWebDavBinary(creds, path, bytes, mime, false))) throw new FileWriteError("Eine Datei mit diesem Namen existiert bereits und wurde nicht überschrieben. Bitte die Datei vor dem Upload umbenennen.");
    return { success: `„${file.name}“ wurde in Nextcloud hochgeladen.` };
  } catch (error) { return { error: message(error) }; }
}

export async function createProtocolMarkdownFile(user: User, areaId: number, sessionId: number, folder: FolderTarget, name: string, deps = { ...dependencies, createWebDavTextExclusive }): Promise<ProtocolMarkdownCreateState> {
  try {
    if (typeof name !== "string" || !name.trim()) throw new FileWriteError("Bitte einen Dateinamen eingeben.");
    const filename = /\.md$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
    const { path, creds } = await target(user, areaId, sessionId, folder, filename, deps);
    if (!(await deps.createWebDavTextExclusive(creds, path, "")).created) throw new FileWriteError("Eine Datei mit diesem Namen existiert bereits und wurde nicht überschrieben. Bitte einen anderen Namen wählen.");
    return { filename };
  } catch (error) { return { error: message(error) }; }
}

export async function saveProtocolPdf(
  user: User, areaId: number, sessionId: number, folderName: FolderTarget, filename: string, fileId: string | null,
  input: SavePdfInput, deps = dependencies,
): Promise<SavePdfResult> {
  try {
    if (!input || input.attachmentId !== sessionId || input.mode !== "replace") throw new FileWriteError("Ungültige PDF-Speicheranfrage.");
    const { path, creds } = await target(user, areaId, sessionId, folderName, filename, deps);
    const assertOriginal = async () => {
      const original = await deps.statWebDavEntry(creds, path);
      if (original.type !== "file" || (fileId && original.fileId !== fileId)) throw new FileWriteError("Die PDF-Datei wurde ersetzt oder umbenannt. Bitte neu laden.");
    };
    await assertOriginal();
    const pdf = await deps.readWebDavPdf(creds, path);
    const result = await deps.applyEditsAndSign(user, input, pdf);
    if (!result.ok) return result;
    if (result.pdf.length > MAX_UPLOAD_BYTES) throw new FileWriteError("Die bearbeitete PDF-Datei ist größer als 25 MB und wurde nicht gespeichert.");
    await assertOriginal();
    if (!(await deps.writeWebDavBinary(creds, path, result.pdf, "application/pdf", true))) throw new FileWriteError("Speichern konnte nicht bestätigt werden.");
    return { ok: true, attachmentId: sessionId, signed: result.signed, warning: result.warning };
  } catch (error) { return { ok: false, error: message(error) }; }
}
