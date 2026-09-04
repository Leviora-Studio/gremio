// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProtocolAreaAccess, getProtocolSession, listProtocolSessionFiles, syncProtocolSessionFile, getProtocolSuggestions } from "@/lib/protocols";
import { readMarkdownDocument, MarkdownDocumentError, type MarkdownTarget } from "@/lib/markdown-documents";
import { getProtocolMembers } from "@/lib/protocol-members";
import { getProtocolGuests } from "@/lib/protocol-guests";
import { getProtocolLogos } from "@/lib/protocol-logos";
import { env } from "@/lib/env";
import { protocolFolderHref, protocolSubfolderSegments } from "@/lib/protocol-paths";
import { DocumentEditor, type DocumentExportTools, type DocumentProtocolTools } from "@/components/documents/DocumentEditor";
import { changeProtocolMembersAction, changeProtocolGuestsAction } from "@/app/intern/protokolle/actions";
import { exportProtocolPdfAction } from "@/app/intern/protokolle/export-actions";
import { saveDocumentAction, reloadDocumentAction, uploadDocumentImageAction } from "../../actions";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";

export const dynamic = "force-dynamic";
export default async function MarkdownDocumentPage({ params, searchParams }: { params: Promise<{ areaId: string; sessionId: string }>; searchParams: Promise<{ name?: string; folder?: string }> }) {
  const paramsValue = await params;
  const areaId = Number(paramsValue.areaId); const sessionId = Number(paramsValue.sessionId);
  if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(sessionId) || sessionId < 1) notFound();
  const { user, area } = await requireProtocolAreaAccess(areaId);
  let session = await getProtocolSession(areaId, sessionId);
  if (!session) notFound();
  const query = await searchParams;
  const filename = query.name;
  const subfolder = query.folder ?? "";
  try { protocolSubfolderSegments(subfolder); } catch { notFound(); }
  if (typeof filename !== "string") notFound();
  const backHref = protocolFolderHref(areaId, sessionId, subfolder);
  let document: Awaited<ReturnType<typeof readMarkdownDocument>>;
  let sessionFiles: Awaited<ReturnType<typeof listProtocolSessionFiles>> = [];
  try {
    sessionFiles = await listProtocolSessionFiles(area, session);
    session = await syncProtocolSessionFile(area, session, sessionFiles);
    document = await readMarkdownDocument(user, { areaId, sessionId, filename, subfolder });
  } catch (error) {
    return <main className="mx-auto max-w-xl space-y-4 p-8"><Link href={backHref} className="text-brand-600">← Zurück zum Sitzungsordner</Link><h1 className="text-xl font-semibold">Dokument nicht verfügbar</h1><p role="alert" className="text-sm text-red-700">{error instanceof MarkdownDocumentError ? error.message : "Die Datei konnte nicht aus Nextcloud geladen werden. Bitte die Verbindung und den Dateinamen prüfen."}</p></main>;
  }
  const target: MarkdownTarget = { areaId, sessionId, filename, subfolder, folderName: session.folderName, fileId: document.file.fileId, isProtocol: document.isProtocol };
  let protocol: DocumentProtocolTools | undefined;
  let exportTools: DocumentExportTools | undefined;
  const sourceFile = sessionFiles.find(file => file.type === "file" && (
    (!!session.protocolFileId && file.fileId === session.protocolFileId) || file.path === session.protocolPath
  ));
  let resultFilename: string | null = null;
  if (sourceFile) {
    try { resultFilename = renderResultProtocolFilename(area.resultFilePattern, area.name, session.folderName, session.sessionDate, sourceFile.name); }
    catch { /* The result workspace presents the precise configuration error. */ }
  }
  const isResultProtocol = !subfolder && resultFilename === filename;
  if (document.isProtocol) {
    const [members, guests, suggestions, logos] = await Promise.all([getProtocolMembers(areaId, sessionId), getProtocolGuests(areaId, sessionId), getProtocolSuggestions(user, area), getProtocolLogos(areaId)]);
    const resultExists = !!resultFilename && sessionFiles.some(file => file.type === "file" && file.name === resultFilename);
    protocol = { areaId, members, guests, suggestions, logos, decisionTemplate: area.boardId && area.decisionTemplateEnabled ? area.decisionTemplateMarkdown : "", hasLinkedBoard: area.boardId !== null, cardBaseUrl: `${env.APP_BASE_URL.replace(/\/$/, "")}/intern/card`, memberAction: changeProtocolMembersAction.bind(null, areaId, sessionId), guestAction: changeProtocolGuestsAction.bind(null, areaId, sessionId), exportAction: exportProtocolPdfAction.bind(null, areaId, sessionId, session.folderName, filename), resultProtocol: { href: `/dokumente/${areaId}/${sessionId}/ergebnis`, exists: resultExists } };
  } else if (isResultProtocol) {
    exportTools = { areaId, logos: await getProtocolLogos(areaId), exportAction: exportProtocolPdfAction.bind(null, areaId, sessionId, session.folderName, filename) };
  }
  const documentType = document.isProtocol ? " · Verlaufsprotokoll" : isResultProtocol ? " · Ergebnisprotokoll" : "";
  return <DocumentEditor key={`${areaId}/${sessionId}/${subfolder}/${filename}`} initialContent={document.content} filename={filename} backHref={backHref} contextLabel={`${area.name} · ${session.folderName}${subfolder ? ` / ${subfolder}` : ""}${documentType}`} saveAction={saveDocumentAction.bind(null, target)} reloadAction={reloadDocumentAction.bind(null, target)} protocol={protocol} exportTools={exportTools} images={{ areaId, sessionId, subfolder, uploadAction: uploadDocumentImageAction.bind(null, target) }} />;
}
