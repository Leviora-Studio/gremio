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
import { getProtocolBoardFields } from "@/lib/protocol-finance-fields";
import { availableProtocolFinanceFields } from "@/lib/protocol-area-config";
import { requireProtocolAreaManage } from "@/lib/protocols";
import { ProtocolAreaConfigForm } from "@/components/protocols/ProtocolAreaConfigForm";
import { SubmitButton } from "@/components/SubmitButton";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { Select } from "@/components/Select";
import { ProtocolLogoSettings } from "@/components/protocols/ProtocolLogoSettings";
import { getProtocolLogos } from "@/lib/protocol-logos";
import { changeProtocolLogoAction } from "../../export-actions";
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
  const fields = await getProtocolBoardFields(boardList.map(board => board.id));
  const boardOptions = boardList.map((board) => ({ id: board.id, name: board.name, statuses: statuses.filter((status) => status.boardId === board.id), fields: availableProtocolFinanceFields(fields.filter(field => field.boardId === board.id && field.visible).map(field => field.key)) }));
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-2">
      <div>
        <Link href={`/intern/protokolle/${areaId}`} className="text-sm text-brand-600">← Zurück zum Protokollbereich</Link>
        <h1 className="text-2xl font-bold">Protokollbereich-Einstellungen</h1>
        <p className="mt-1 text-sm text-slate-500">{area.name}</p>
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
          customTemplateMarkdown: area.customTemplateMarkdown,
          financeFields: area.financeFields,
          decisionTemplateEnabled: area.decisionTemplateEnabled,
          decisionTemplateMarkdown: area.decisionTemplateMarkdown,
          boardId: area.boardId,
          sourceStatusId: area.sourceStatusId,
          decisionRefPattern: area.decisionRefPattern,
        }}
      />

      <ProtocolLogoSettings areaId={areaId} initialLogos={await getProtocolLogos(areaId)} action={changeProtocolLogoAction.bind(null, areaId)} />

      <CollapsibleSection title="Freigaben" contentClassName="space-y-4">
        <p className="text-sm text-slate-500">Freigaben erlauben Sitzungen und Protokolle zu sehen und zu bearbeiten. Konfiguration bleibt Eigentümer und Administratoren vorbehalten.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <form action={addProtocolAreaUserAccessAction.bind(null, areaId)} className="flex items-end gap-2">
            <div className="min-w-0 flex-1"><label className="label">Nutzer</label><Select portal searchable name="userId" ariaLabel="Nutzer" defaultValue={String(activeUsers[0]?.id ?? "")} options={activeUsers.map(entry => ({ value: String(entry.id), label: entry.username }))} /></div>
            <SubmitButton className="btn-secondary">Freigeben</SubmitButton>
          </form>
          <form action={addProtocolAreaGroupAccessAction.bind(null, areaId)} className="flex items-end gap-2">
            <div className="min-w-0 flex-1"><label className="label">Gruppe</label><Select portal searchable name="groupId" ariaLabel="Gruppe" defaultValue={String(allGroups[0]?.id ?? "")} options={allGroups.map(group => ({ value: String(group.id), label: group.name }))} /></div>
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
      </CollapsibleSection>

      <CollapsibleSection title="Eigentum" className="border-red-200">
        <h2 className="mb-3 font-semibold">Eigentümer übertragen</h2>
        <form action={transferProtocolAreaOwnerAction.bind(null, areaId)} className="flex max-w-lg items-end gap-2">
          <div className="min-w-0 flex-1"><label className="label">Neuer Eigentümer</label><Select portal searchable name="ownerId" ariaLabel="Neuer Eigentümer" defaultValue={String(area.ownerId)} options={activeUsers.map(entry => ({ value: String(entry.id), label: entry.username }))} /></div>
          <SubmitButton className="btn-secondary">Übertragen</SubmitButton>
        </form>
      </CollapsibleSection>

    </div>
  );
}
