// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardStatuses,
  groups,
  protocolAreaAccess,
  protocolTemplates,
  users,
} from "@/lib/db/schema";
import { getAccessibleBoards } from "@/lib/authz";
import { requireProtocolAreaManage } from "@/lib/protocols";
import { ProtocolAreaConfigForm } from "@/components/protocols/ProtocolAreaConfigForm";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addProtocolAreaGroupAccessAction,
  addProtocolAreaUserAccessAction,
  removeProtocolAreaAccessAction,
  transferProtocolAreaOwnerAction,
  updateProtocolAreaAction,
} from "../../actions";

export default async function ProtocolSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const areaId = Number(id);
  const { user, area } = await requireProtocolAreaManage(areaId);
  const [templates, activeUsers, allGroups, access, accessibleBoards] = await Promise.all([
    db.select({ id: protocolTemplates.id, name: protocolTemplates.name }).from(protocolTemplates).orderBy(asc(protocolTemplates.name)),
    db.select({ id: users.id, username: users.username }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.username)),
    db.select({ id: groups.id, name: groups.name }).from(groups).orderBy(asc(groups.name)),
    db.select({ id: protocolAreaAccess.id, userId: protocolAreaAccess.userId, groupId: protocolAreaAccess.groupId, username: users.username, groupName: groups.name })
      .from(protocolAreaAccess)
      .leftJoin(users, eq(users.id, protocolAreaAccess.userId))
      .leftJoin(groups, eq(groups.id, protocolAreaAccess.groupId))
      .where(eq(protocolAreaAccess.areaId, areaId)),
    getAccessibleBoards(user),
  ]);
  const boardList = accessibleBoards.filter((board) => board.inventoryBoardId == null);
  const statuses = boardList.length
    ? await db.select({ id: boardStatuses.id, boardId: boardStatuses.boardId, name: boardStatuses.name }).from(boardStatuses).where(inArray(boardStatuses.boardId, boardList.map((board) => board.id))).orderBy(asc(boardStatuses.position))
    : [];
  const boardOptions = boardList.map((board) => ({ id: board.id, name: board.name, statuses: statuses.filter((status) => status.boardId === board.id) }));
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href={`/intern/protokolle/${areaId}`} className="text-sm text-brand-600">← Zurück zum Protokollbereich</Link>
        <h1 className="mt-1 text-2xl font-bold">Einstellungen: {area.name}</h1>
      </div>
      <ProtocolAreaConfigForm
        action={updateProtocolAreaAction.bind(null, areaId)}
        templates={templates}
        boards={boardOptions}
        initial={{
          name: area.name,
          description: area.description,
          ncUrl: area.ncUrl,
          ncUsername: area.ncUsername,
          rootPath: area.rootPath,
          folderPattern: area.folderPattern,
          filePattern: area.filePattern,
          templateId: area.templateId,
          boardId: area.boardId,
          sourceStatusId: area.sourceStatusId,
          decisionRefPattern: area.decisionRefPattern,
        }}
      />

      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold">Zugriffsfreigaben</h2>
        <p className="text-sm text-slate-500">Freigaben erlauben Sitzungen und Protokolle zu sehen und zu bearbeiten. Konfiguration bleibt Eigentümer und Administratoren vorbehalten.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <form action={addProtocolAreaUserAccessAction.bind(null, areaId)} className="flex items-end gap-2">
            <div className="flex-1"><label className="label">Nutzer</label><select name="userId" className="input">{activeUsers.map((entry) => <option key={entry.id} value={entry.id}>{entry.username}</option>)}</select></div>
            <SubmitButton className="btn-secondary">Freigeben</SubmitButton>
          </form>
          <form action={addProtocolAreaGroupAccessAction.bind(null, areaId)} className="flex items-end gap-2">
            <div className="flex-1"><label className="label">Gruppe</label><select name="groupId" className="input">{allGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
            <SubmitButton className="btn-secondary">Freigeben</SubmitButton>
          </form>
        </div>
        <div className="space-y-2">
          {access.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
              <span>{entry.username ? `Nutzer: ${entry.username}` : `Gruppe: ${entry.groupName}`}</span>
              <form action={removeProtocolAreaAccessAction.bind(null, areaId, entry.id)}><SubmitButton className="btn-secondary btn-sm">Entfernen</SubmitButton></form>
            </div>
          ))}
          {access.length === 0 && <p className="text-sm text-slate-500">Noch keine Freigaben.</p>}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">Eigentümer übertragen</h2>
        <form action={transferProtocolAreaOwnerAction.bind(null, areaId)} className="flex max-w-lg items-end gap-2">
          <div className="flex-1"><label className="label">Neuer Eigentümer</label><select name="ownerId" defaultValue={area.ownerId} className="input">{activeUsers.map((entry) => <option key={entry.id} value={entry.id}>{entry.username}</option>)}</select></div>
          <SubmitButton className="btn-secondary">Übertragen</SubmitButton>
        </form>
      </section>

    </div>
  );
}
