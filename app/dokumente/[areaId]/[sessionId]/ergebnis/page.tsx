// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultProtocolEditor } from "@/components/documents/ResultProtocolEditor";
import { MarkdownDocumentError, readMarkdownDocument, type MarkdownTarget } from "@/lib/markdown-documents";
import { initialResultProtocol, analyzeResultProtocol } from "@/lib/result-protocol";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";
import { getProtocolSession, listProtocolSessionFiles, requireProtocolAreaAccess, syncProtocolSessionFile } from "@/lib/protocols";
import { saveResultProtocolAction, reloadResultProtocolAction } from "@/app/dokumente/ergebnis-actions";
import { getProtocolLogos } from "@/lib/protocol-logos";
import { exportProtocolPdfAction } from "@/app/intern/protokolle/export-actions";

export const dynamic = "force-dynamic";

export default async function ResultProtocolPage({ params }: { params: Promise<{ areaId: string; sessionId: string }> }) {
  const value = await params;
  const areaId = Number(value.areaId); const sessionId = Number(value.sessionId);
  if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(sessionId) || sessionId < 1) notFound();
  const { user, area } = await requireProtocolAreaAccess(areaId);
  let session = await getProtocolSession(areaId, sessionId);
  if (!session) notFound();
  const backHref = `/intern/protokolle/${areaId}/sitzung/${sessionId}`;
  try {
    const files = await listProtocolSessionFiles(area, session);
    session = await syncProtocolSessionFile(area, session, files);
    const currentSession = session;
    const sourceFile = files.find(file => file.type === "file" && (
      (!!currentSession.protocolFileId && file.fileId === currentSession.protocolFileId) || file.path === currentSession.protocolPath
    ));
    if (!sourceFile || !session.protocolPath) throw new MarkdownDocumentError("Die registrierte Protokolldatei ist nicht mehr verfügbar. Bitte den Sitzungsordner synchronisieren.");
    const sourceTarget: MarkdownTarget = {
      areaId,
      sessionId,
      filename: sourceFile.name,
      folderName: session.folderName,
      fileId: sourceFile.fileId,
      isProtocol: true,
    };
    const source = await readMarkdownDocument(user, sourceTarget);
    let resultFilename: string;
    try {
      resultFilename = renderResultProtocolFilename(area.resultFilePattern, area.name, session.folderName, session.sessionDate, sourceFile.name);
    } catch (error) {
      throw new MarkdownDocumentError(error instanceof Error ? error.message : "Das Namensschema der Ergebnisprotokolldatei ist ungültig.");
    }
    const resultFile = files.find(file => file.type === "file" && file.name === resultFilename);
    const result = resultFile ? await readMarkdownDocument(user, {
      areaId,
      sessionId,
      filename: resultFilename,
      folderName: session.folderName,
      fileId: resultFile.fileId,
      isProtocol: false,
    }) : null;
    const initialResult = result?.content ?? initialResultProtocol(analyzeResultProtocol(source.content), session.folderName);
    const logos = await getProtocolLogos(areaId);
    return <ResultProtocolEditor
      sourceContent={source.content}
      initialResult={initialResult}
      initialFileId={result?.file.fileId ?? null}
      initiallyPersisted={!!result}
      filename={resultFilename}
      folderName={session.folderName}
      backHref={`/dokumente/${areaId}/${sessionId}?name=${encodeURIComponent(sourceFile.name)}`}
      saveAction={saveResultProtocolAction.bind(null, sourceTarget, resultFilename)}
      reloadAction={reloadResultProtocolAction.bind(null, sourceTarget, resultFilename)}
      areaId={areaId}
      logos={logos}
      exportAction={exportProtocolPdfAction.bind(null, areaId, sessionId, session.folderName, resultFilename)}
    />;
  } catch (error) {
    return <main className="mx-auto max-w-xl space-y-4 p-8"><Link href={backHref} className="text-brand-600">← Zurück zum Sitzungsordner</Link><h1 className="text-xl font-semibold">Ergebnisprotokoll nicht verfügbar</h1><p role="alert" className="text-sm text-red-700">{error instanceof MarkdownDocumentError ? error.message : "Die Dateien konnten nicht aus Nextcloud geladen werden. Bitte Verbindung und Dateiliste prüfen."}</p></main>;
  }
}
