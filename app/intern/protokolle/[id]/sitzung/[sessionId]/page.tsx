// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { protocolTemplates } from "@/lib/db/schema";
import { todayInBerlin } from "@/lib/dates";
import {
  nextcloudBrowserUrl,
} from "@/lib/nextcloud";
import {
  getProtocolSession,
  listProtocolSessionFiles,
  requireProtocolAreaAccess,
  syncProtocolSessionFile,
} from "@/lib/protocols";
import { CreateProtocolForm } from "@/components/protocols/CreateProtocolForm";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
import { protocolImageMime } from "@/lib/protocol-image";
import { ProtocolFileUpload } from "@/components/protocols/ProtocolFileUpload";
import { createProtocolMarkdownFileAction, uploadProtocolFileAction, saveProtocolPdfEditsAction } from "../../../file-actions";
import { CreateMarkdownFileButton } from "@/components/protocols/CreateMarkdownFileButton";
import { isMarkdownFilename } from "@/lib/markdown-documents";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";
import { protocolDirectoryPath, protocolFolderHref, protocolSubfolderSegments } from "@/lib/protocol-paths";
import {
  createProtocolForSessionAction,
  deleteProtocolFileAction,
} from "../../../actions";

function fileType(name: string, mime: string | null, type: "file" | "directory") {
  if (type === "directory") return "Ordner";
  if (mime) return mime;
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : "Datei";
}

export default async function ProtocolSessionPage({ params, searchParams }: { params: Promise<{ id: string; sessionId: string }>; searchParams: Promise<{ existing?: string; folder?: string }> }) {
  const { id, sessionId: rawSessionId } = await params;
  const areaId = Number(id);
  const sessionId = Number(rawSessionId);
  const { user, area } = await requireProtocolAreaAccess(areaId);
  let session = await getProtocolSession(areaId, sessionId);
  if (!session) notFound();
  const query = await searchParams;
  const subfolder = query.folder ?? "";
  let segments: string[];
  try { segments = protocolSubfolderSegments(subfolder); } catch { notFound(); }
  const currentPath = protocolDirectoryPath(area.rootPath, session.folderName, subfolder);
  const folderQuery = subfolder ? `&folder=${encodeURIComponent(subfolder)}` : "";

  let files = [] as Awaited<ReturnType<typeof listProtocolSessionFiles>>;
  let loadError: string | null = null;
  try {
    files = await listProtocolSessionFiles(area, session, subfolder);
    if (!subfolder) session = await syncProtocolSessionFile(area, session, files);
  } catch (error) {
    loadError = (error as Error).message;
  }
  const protocolFile = session.protocolPath
    ? files.find((file) => file.path === session.protocolPath || (!!session.protocolFileId && file.fileId === session.protocolFileId))
    : undefined;
  let resultProtocolFilename: string | null = null;
  if (!subfolder && protocolFile) {
    try { resultProtocolFilename = renderResultProtocolFilename(area.resultFilePattern, area.name, session.folderName, session.sessionDate, protocolFile.name); }
    catch { /* The result workspace presents the precise configuration error. */ }
  }
  const templates = !subfolder && !session.protocolPath ? await db.select({ id: protocolTemplates.id, name: protocolTemplates.name }).from(protocolTemplates).orderBy(asc(protocolTemplates.name)) : [];

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <div>
        <Link href={`/intern/protokolle/${area.id}`} className="text-sm text-brand-600">← {area.name}</Link>
        <h1 className="mt-1 text-2xl font-bold">Sitzung {session.folderName}</h1>
      </div>
      {query.existing && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Der berechnete Sitzungsordner existierte bereits. Er wurde geöffnet und nicht überschrieben.</div>}
      {loadError && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800"><strong>Nextcloud nicht erreichbar oder Datei nicht lesbar:</strong> {loadError}</div>}

      <details key={subfolder} className="collapsible card" open>
        <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 rounded-lg p-4 hover:bg-slate-50">
          <h2 className="flex items-center gap-2 font-semibold">
            <svg className="chev h-5 w-5 shrink-0 text-slate-400 transition-transform" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {subfolder ? `Dateien in „${segments.at(-1)}“` : "Dateien im Sitzungsordner"}
          </h2>
          <a href={nextcloudBrowserUrl(area.ncUrl, currentPath, subfolder ? null : session.folderFileId, true)} target="_blank" rel="noopener" className="text-sm text-brand-600 hover:underline">In Nextcloud öffnen</a>
        </summary>
        <nav aria-label="Ordnerpfad" className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 text-sm">
          <Link href={protocolFolderHref(areaId, sessionId)} aria-current={!subfolder ? "page" : undefined} className="text-brand-600 hover:underline">{session.folderName}</Link>
          {segments.map((segment, index) => <span key={index} className="inline-flex items-center gap-2"><span aria-hidden="true" className="text-slate-400">/</span><Link href={protocolFolderHref(areaId, sessionId, segments.slice(0, index + 1).join("/"))} aria-current={index === segments.length - 1 ? "page" : undefined} className="text-brand-600 hover:underline">{segment}</Link></span>)}
          {subfolder && <Link href={protocolFolderHref(areaId, sessionId, segments.slice(0, -1).join("/"))} className="ml-auto text-brand-600 hover:underline">← Übergeordneter Ordner</Link>}
        </nav>
        <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Name</th><th className="p-3">Typ</th><th className="p-3">Geändert</th><th className="p-3" /></tr></thead>
          <tbody>
            {files.map((file) => {
              const isPdf = file.type === "file" && (file.mime?.split(";")[0].trim().toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name));
              const imageMime = file.type === "file" && !isPdf ? protocolImageMime(file.name, file.mime) : null;
              const imageProps = {
                id: session.id,
                filename: file.name,
                mime: imageMime ?? "application/octet-stream",
                src: `/api/protokolle/${area.id}/sitzung/${session.id}/image?name=${encodeURIComponent(file.name)}${folderQuery}`,
                className: "text-brand-600 hover:underline",
              };
              const pdfProps = {
                id: session.id,
                filename: file.name,
                mime: "application/pdf",
                src: `/api/protokolle/${area.id}/sitzung/${session.id}/pdf?name=${encodeURIComponent(file.name)}${folderQuery}`,
                editable: true,
                hasCert: !!user.certP12Enc,
                fieldsUrl: `/api/protokolle/${area.id}/sitzung/${session.id}/pdf/fields?name=${encodeURIComponent(file.name)}${folderQuery}`,
                saveAction: saveProtocolPdfEditsAction.bind(null, area.id, session.id, session.folderName, file.name, file.fileId, subfolder),
                className: "text-brand-600 hover:underline",
              };
              return (
              <tr key={file.path} className="border-t border-slate-100">
                <td className="p-3 font-medium">
                  {file.type === "directory" ? <Link href={protocolFolderHref(areaId, sessionId, [...segments, file.name].join("/"))} className="text-brand-600 hover:underline">{file.name}</Link> : isMarkdownFilename(file.name) ? <Link href={`/dokumente/${areaId}/${sessionId}?name=${encodeURIComponent(file.name)}${folderQuery}`} className="text-brand-600 hover:underline">{file.name}</Link> : isPdf ? <AttachmentLink {...pdfProps} /> : imageMime ? <AttachmentLink {...imageProps} /> : <a href={nextcloudBrowserUrl(area.ncUrl, file.path, file.fileId, false)} target="_blank" rel="noopener" className="text-brand-600 hover:underline">{file.name}</a>}
                  {file.path === protocolFile?.path && <span className="ml-2 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Verlaufsprotokoll</span>}
                  {file.type === "file" && file.name === resultProtocolFilename && <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Ergebnisprotokoll</span>}
                </td>
                <td className="p-3 text-slate-600">{fileType(file.name, file.mime, file.type)}</td>
                <td className="p-3 text-slate-600">{file.lastModified ? new Date(file.lastModified).toLocaleString("de-DE") : "—"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <a href={nextcloudBrowserUrl(area.ncUrl, file.path, file.fileId, file.type === "directory")} target="_blank" rel="noopener" className="text-brand-600 hover:underline">In Nextcloud öffnen</a>
                    {file.type === "directory" && <Link href={protocolFolderHref(areaId, sessionId, [...segments, file.name].join("/"))} className="text-brand-600 hover:underline">Öffnen</Link>}
                    {file.type === "file" && (
                      <DeleteConfirm
                        action={deleteProtocolFileAction.bind(null, areaId, sessionId, session.folderName, file.name, file.fileId, subfolder)}
                        requireWord={false}
                        buttonLabel="Datei löschen"
                        buttonClassName="text-red-600 hover:underline"
                        title={`Datei „${file.name}“ löschen?`}
                        message={`Die Datei „${file.name}“ wird aus dem Nextcloud-Sitzungsordner „${session.folderName}${subfolder ? ` / ${subfolder}` : ""}“ gelöscht. ${file.path === protocolFile?.path ? "Die Finanzantrags-Verknüpfungen dieses Verlaufsprotokolls werden entfernt; ungespeicherte Editoränderungen gehen verloren. " : ""}Eine Wiederherstellung wird von Gremio nicht angeboten.`}
                      />
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {files.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Keine Dateien gefunden.</td></tr>}
          </tbody>
        </table>
        </div>
        {!loadError && <ProtocolFileUpload key={subfolder} action={uploadProtocolFileAction.bind(null, area.id, session.id, session.folderName, subfolder)} extraActions={<CreateMarkdownFileButton action={createProtocolMarkdownFileAction.bind(null, area.id, session.id, session.folderName, subfolder)} />} />}
      </details>

      {!subfolder && !session.protocolPath && !loadError && <section><h2 className="mb-2 text-lg font-semibold">Protokoll erstellen</h2><CreateProtocolForm action={createProtocolForSessionAction.bind(null, areaId, sessionId)} date={session.sessionDate ?? todayInBerlin()} templates={templates} defaultTemplateId={area.templateId} /></section>}
    </div>
  );
}
