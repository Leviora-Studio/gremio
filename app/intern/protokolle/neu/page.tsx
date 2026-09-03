// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";
import { db } from "@/lib/db";
import { boardStatuses, protocolTemplates } from "@/lib/db/schema";
import { ProtocolAreaConfigForm } from "@/components/protocols/ProtocolAreaConfigForm";
import { createProtocolAreaAction } from "../actions";

export default async function NewProtocolAreaPage() {
  const user = await requireUser();
  const templates = await db.select({ id: protocolTemplates.id, name: protocolTemplates.name }).from(protocolTemplates).orderBy(asc(protocolTemplates.name));
  const accessible = (await getAccessibleBoards(user)).filter((board) => board.inventoryBoardId == null);
  const statuses = accessible.length
    ? await db.select({ id: boardStatuses.id, boardId: boardStatuses.boardId, name: boardStatuses.name }).from(boardStatuses).where(inArray(boardStatuses.boardId, accessible.map((board) => board.id))).orderBy(asc(boardStatuses.position))
    : [];
  const boardOptions = accessible.map((board) => ({ id: board.id, name: board.name, statuses: statuses.filter((status) => status.boardId === board.id) }));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/intern/protokolle" className="text-sm text-brand-600">← Zurück zu Protokolle</Link>
      <div>
        <h1 className="text-2xl font-bold">Neuer Protokollbereich</h1>
        <p className="text-sm text-slate-500">Die Verbindung wird vor dem Anlegen geprüft; der Wurzelordner wird bei Bedarf erstellt.</p>
      </div>
      {templates.length === 0 && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Zuerst muss ein Template-Verwalter unter „Vorlagen → Protokollvorlagen“ eine Vorlage anlegen.</div>}
      <ProtocolAreaConfigForm action={createProtocolAreaAction} templates={templates} boards={boardOptions} />
    </div>
  );
}
