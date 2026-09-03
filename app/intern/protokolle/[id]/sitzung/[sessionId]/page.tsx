// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { protocolSessions, protocolTemplates } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { todayInBerlin } from "@/lib/dates";
import {
  nextcloudBrowserUrl,
  readWebDavText,
} from "@/lib/nextcloud";
import {
  getProtocolSession,
  getProtocolSuggestions,
  listProtocolSessionFiles,
  protocolCredentials,
  requireProtocolAreaAccess,
} from "@/lib/protocols";
import { CreateProtocolForm } from "@/components/protocols/CreateProtocolForm";
import { ProtocolEditor } from "@/components/protocols/ProtocolEditor";
import {
  createProtocolForSessionAction,
  loadProtocolDocumentAction,
  saveProtocolAction,
} from "../../../actions";

function fileType(name: string, mime: string | null, type: "file" | "directory") {
  if (type === "directory") return "Ordner";
  if (mime) return mime;
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : "Datei";
}

export default async function ProtocolSessionPage({ params, searchParams }: { params: Promise<{ id: string; sessionId: string }>; searchParams: Promise<{ existing?: string }> }) {
  const { id, sessionId: rawSessionId } = await params;
  const areaId = Number(id);
  const sessionId = Number(rawSessionId);
  const { user, area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session) notFound();
  const query = await searchParams;

  let files = [] as Awaited<ReturnType<typeof listProtocolSessionFiles>>;
  let loadError: string | null = null;
  try {
    files = await listProtocolSessionFiles(area, session);
  } catch (error) {
    loadError = (error as Error).message;
  }
  const protocolFile = session.protocolPath
    ? files.find((file) => file.path === session.protocolPath || (!!session.protocolFileId && file.fileId === session.protocolFileId))
    : undefined;
  if (protocolFile && protocolFile.path !== session.protocolPath) {
    session.protocolPath = protocolFile.path;
    session.protocolEtag = protocolFile.etag;
    session.protocolFileId = protocolFile.fileId;
    await db
      .update(protocolSessions)
      .set({
        protocolPath: protocolFile.path,
        protocolEtag: protocolFile.etag,
        protocolFileId: protocolFile.fileId,
        protocolLastModified: protocolFile.lastModified ? new Date(protocolFile.lastModified) : null,
        lastSyncedAt: new Date(),
      })
      .where(eq(protocolSessions.id, session.id));
  }
  let document: { content: string; etag: string } | null = null;
  if (session.protocolPath) {
    try {
      const result = await readWebDavText(protocolCredentials(area), protocolFile?.path ?? session.protocolPath);
      document = {
        content: result.content,
        etag: result.stat.etag ?? (result.stat.lastModified ? `lastmod:${result.stat.lastModified}` : ""),
      };
    } catch (error) {
      loadError = (error as Error).message;
    }
  }
  const [templates, suggestions] = await Promise.all([
    db.select({ id: protocolTemplates.id, name: protocolTemplates.name }).from(protocolTemplates).orderBy(asc(protocolTemplates.name)),
    getProtocolSuggestions(user, area),
  ]);

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <div>
        <Link href={`/intern/protokolle/${area.id}`} className="text-sm text-brand-600">← {area.name}</Link>
        <h1 className="mt-1 text-2xl font-bold">Sitzung {session.folderName}</h1>
      </div>
      {query.existing && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Der berechnete Sitzungsordner existierte bereits. Er wurde geöffnet und nicht überschrieben.</div>}
      {loadError && <div className="rounded-md bg-red-50 p-3 text-sm text-red-800"><strong>Nextcloud nicht erreichbar oder Datei nicht lesbar:</strong> {loadError}</div>}

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="font-semibold">Dateien im Sitzungsordner</h2>
          <a href={nextcloudBrowserUrl(area.ncUrl, `${area.rootPath}/${session.folderName}`, session.folderFileId, true)} target="_blank" rel="noopener" className="text-sm text-brand-600 hover:underline">In Nextcloud öffnen</a>
        </div>
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Name</th><th className="p-3">Typ</th><th className="p-3">Geändert</th><th className="p-3" /></tr></thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path} className="border-t border-slate-100">
                <td className="p-3 font-medium">{file.name}{file.path === protocolFile?.path && <span className="ml-2 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Protokoll</span>}</td>
                <td className="p-3 text-slate-600">{fileType(file.name, file.mime, file.type)}</td>
                <td className="p-3 text-slate-600">{file.lastModified ? new Date(file.lastModified).toLocaleString("de-DE") : "—"}</td>
                <td className="p-3 text-right"><a href={nextcloudBrowserUrl(area.ncUrl, file.path, file.fileId, file.type === "directory")} target="_blank" rel="noopener" className="text-brand-600 hover:underline">In Nextcloud öffnen</a></td>
              </tr>
            ))}
            {files.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Keine Dateien gefunden.</td></tr>}
          </tbody>
        </table>
      </section>

      {!session.protocolPath && !loadError && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Protokoll fehlt</h2>
          <CreateProtocolForm action={createProtocolForSessionAction.bind(null, areaId, sessionId)} date={session.sessionDate ?? todayInBerlin()} templates={templates} defaultTemplateId={area.templateId} />
        </section>
      )}

      {document && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Protokoll bearbeiten</h2>
          <ProtocolEditor
            initialContent={document.content}
            initialEtag={document.etag}
            suggestions={suggestions}
            cardBaseUrl={`${env.APP_BASE_URL.replace(/\/$/, "")}/intern/card`}
            saveAction={saveProtocolAction.bind(null, areaId, sessionId)}
            reloadAction={loadProtocolDocumentAction.bind(null, areaId, sessionId)}
          />
        </section>
      )}
    </div>
  );
}
