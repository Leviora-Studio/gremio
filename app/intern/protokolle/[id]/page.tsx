// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { db } from "@/lib/db";
import { protocolSessions } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { canManageProtocolArea, requireProtocolAreaAccess, syncProtocolSessions } from "@/lib/protocols";
import { todayInBerlin } from "@/lib/dates";
import { CreateSessionForm } from "@/components/protocols/CreateSessionForm";
import { SyncProtocolButton } from "@/components/protocols/SyncProtocolButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { createSessionAction, deleteProtocolSessionAction, syncProtocolAreaAction } from "../actions";

export default async function ProtocolAreaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const areaId = Number(id);
  const { user, area } = await requireProtocolAreaAccess(areaId);
  let syncError: string | null = null;
  let sessions;
  try {
    sessions = (await syncProtocolSessions(area)).sort((a, b) => b.folderName.localeCompare(a.folderName));
  } catch (error) {
    syncError = (error as Error).message;
    sessions = await db.select().from(protocolSessions).where(eq(protocolSessions.areaId, area.id)).orderBy(desc(protocolSessions.folderName));
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/intern/protokolle" className="text-sm text-brand-600">← Protokollbereiche</Link>
          <h1 className="mt-1 text-2xl font-bold">{area.name}</h1>
          {area.description && <p className="text-sm text-slate-500">{area.description}</p>}
        </div>
        {canManageProtocolArea(user, area) && <Link href={`/intern/protokolle/${area.id}/einstellungen`} className="btn-secondary">Einstellungen</Link>}
      </div>
      {syncError && <div className="rounded-md bg-red-50 p-4 text-sm text-red-800"><strong>Nextcloud nicht erreichbar.</strong> Die unten sichtbaren Sitzungen stammen aus dem letzten erfolgreichen Abgleich. {syncError}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <SyncProtocolButton action={syncProtocolAreaAction.bind(null, area.id)} />
        <span className="text-xs text-slate-500">Nextcloud ist für Ordner und Dateien maßgeblich.</span>
      </div>
      <CreateSessionForm action={createSessionAction.bind(null, area.id)} today={todayInBerlin()} />
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3">Sitzung</th><th className="p-3">Protokoll</th><th className="p-3">Letzter Abgleich</th><th className="p-3" /></tr></thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="border-b border-slate-100 last:border-0">
                <td className="p-3 font-medium"><Link href={`/intern/protokolle/${area.id}/sitzung/${session.id}`} className="text-brand-600 hover:underline">{session.folderName}</Link></td>
                <td className="p-3">{session.protocolPath ? "Vorhanden" : "Fehlt"}</td>
                <td className="p-3 text-slate-500">{session.lastSyncedAt.toLocaleString("de-DE")}</td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/intern/protokolle/${area.id}/sitzung/${session.id}`} className="text-brand-600 hover:underline">Öffnen</Link>
                    <DeleteConfirm
                      action={deleteProtocolSessionAction.bind(null, area.id, session.id, session.folderName)}
                      buttonLabel="Löschen"
                      buttonClassName="text-red-600 hover:underline"
                      wordInModal
                      title={`Sitzung „${session.folderName}“ vollständig löschen?`}
                      message={`Der Nextcloud-Ordner „${session.folderName}“ wird mit sämtlichen Dateien und Unterordnern gelöscht. Sitzungsverknüpfungen werden entfernt. Ungespeicherte Editoränderungen gehen verloren. Eine Wiederherstellung wird von Gremio nicht angeboten.`}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Keine Sitzungsordner in Nextcloud gefunden.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
