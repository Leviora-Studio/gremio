// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardEmailRules,boardStatuses } from "@/lib/db/schema";
import { BoardEmailRuleForm } from "./BoardEmailRuleForm";
/** Parent settings page must authorize management before rendering. */
export async function BoardEmailSettings({boardId}:{boardId:number}) {
  const statuses=await db.select().from(boardStatuses).where(eq(boardStatuses.boardId,boardId)).orderBy(asc(boardStatuses.position));
  const rules=await db.select({statusId:boardEmailRules.statusId,enabled:boardEmailRules.enabled,recipients:boardEmailRules.recipients}).from(boardEmailRules).innerJoin(boardStatuses,eq(boardStatuses.id,boardEmailRules.statusId)).where(eq(boardStatuses.boardId,boardId));
  return <div className="space-y-4"><p className="text-sm text-slate-500">Lege pro Spalte fest, ob und an welche Adressen bei Eingang oder Statuswechsel eine Nachricht versendet wird. Der Admin muss den SMTP-Versand der Instanz aktivieren. Reines Umsortieren innerhalb derselben Spalte versendet keine Nachricht.</p>
    {statuses.map(status=>{const rule=rules.find(value=>value.statusId===status.id);return <BoardEmailRuleForm key={status.id} boardId={boardId} status={status} enabled={rule?.enabled??false} recipients={rule?.recipients??[]} />;})}
  </div>;
}
