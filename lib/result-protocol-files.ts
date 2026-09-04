// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { User } from "@/lib/db/schema";
import { createWebDavTextExclusive, MAX_MARKDOWN_BYTES } from "@/lib/nextcloud";
import { protocolFilePath } from "@/lib/protocol-paths";
import {
  MarkdownDocumentError,
  readMarkdownDocument,
  resolveMarkdownDocument,
  saveMarkdownDocument,
  type MarkdownTarget,
} from "@/lib/markdown-documents";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";

const dependencies = {
  createWebDavTextExclusive,
  readMarkdownDocument,
  resolveMarkdownDocument,
  saveMarkdownDocument,
};

type Dependencies = typeof dependencies;

export type ResultProtocolSave = {
  content: string;
  fileId: string | null;
  savedToNextcloud: boolean;
  openedExisting?: boolean;
  success: string;
};

function resultTarget(source: MarkdownTarget, folderName: string, filename: string, fileId?: string | null): MarkdownTarget {
  return {
    areaId: source.areaId,
    sessionId: source.sessionId,
    filename,
    folderName,
    fileId,
    isProtocol: false,
  };
}

function configuredResultFilename(
  area: { resultFilePattern: string; name: string },
  session: { folderName: string; sessionDate: string | null },
  sourceFilename: string,
): string {
  try {
    return renderResultProtocolFilename(area.resultFilePattern, area.name, session.folderName, session.sessionDate, sourceFilename);
  } catch (error) {
    throw new MarkdownDocumentError(error instanceof Error ? error.message : "Das Namensschema der Ergebnisprotokolldatei ist ungültig.");
  }
}

/**
 * The registered source protocol is resolved first on every write. This keeps
 * permissions, session identity, folder identity and source classification at
 * the same server-side boundary as the normal document editor.
 */
export async function saveResultProtocol(
  user: User,
  source: MarkdownTarget,
  expectedResultFilename: string,
  expectedFileId: string | null | undefined,
  content: string,
  deps: Dependencies = dependencies,
): Promise<ResultProtocolSave> {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX_MARKDOWN_BYTES) {
    throw new MarkdownDocumentError("Markdown-Dateien dürfen höchstens 2 MB groß sein.");
  }
  const sourceContext = await deps.resolveMarkdownDocument(user, { ...source, isProtocol: true });
  if (!sourceContext.isProtocol || source.subfolder) throw new MarkdownDocumentError("Das Ergebnisprotokoll kann nur aus der registrierten Protokolldatei erstellt werden.");
  const filename = configuredResultFilename(sourceContext.area, sourceContext.session, source.filename);
  if (filename !== expectedResultFilename) throw new MarkdownDocumentError("Das Namensschema für Ergebnisprotokolle wurde geändert. Bitte die Arbeitsansicht neu öffnen.");
  const target = resultTarget(source, sourceContext.session.folderName, filename, expectedFileId);
  if (expectedFileId !== undefined) {
    const saved = await deps.saveMarkdownDocument(user, target, content);
    const current = await deps.resolveMarkdownDocument(user, target);
    return { ...saved, content, fileId: current.file.fileId ?? null, success: "In Nextcloud gespeichert." };
  }
  const path = protocolFilePath(sourceContext.area.rootPath, sourceContext.session.folderName, filename);
  const created = await deps.createWebDavTextExclusive(sourceContext.creds, path, content);
  if (created.created) {
    return { content, fileId: created.stat?.fileId ?? null, savedToNextcloud: true, success: "Ergebnisprotokoll in Nextcloud angelegt." };
  }
  const existing = await deps.readMarkdownDocument(user, resultTarget(source, sourceContext.session.folderName, filename));
  return {
    content: existing.content,
    fileId: existing.file.fileId ?? null,
    savedToNextcloud: true,
    openedExisting: true,
    success: "Die vorhandene Ergebnisdatei wurde geöffnet und nicht überschrieben.",
  };
}

export async function reloadResultProtocol(
  user: User,
  source: MarkdownTarget,
  expectedResultFilename: string,
  expectedFileId: string | null,
  deps: Dependencies = dependencies,
) {
  const sourceContext = await deps.resolveMarkdownDocument(user, { ...source, isProtocol: true });
  if (!sourceContext.isProtocol || source.subfolder) throw new MarkdownDocumentError("Ungültige Ergebnisprotokoll-Anfrage.");
  const filename = configuredResultFilename(sourceContext.area, sourceContext.session, source.filename);
  if (filename !== expectedResultFilename) throw new MarkdownDocumentError("Das Namensschema für Ergebnisprotokolle wurde geändert. Bitte die Arbeitsansicht neu öffnen.");
  const result = await deps.readMarkdownDocument(user, resultTarget(source, sourceContext.session.folderName, filename, expectedFileId));
  return { content: result.content, fileId: result.file.fileId ?? null };
}
