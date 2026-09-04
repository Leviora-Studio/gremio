// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, boardCardFields, boardStatuses } from "@/lib/db/schema";
import {
  canManageBoard,
  getBoardMemberUsers,
  requireBoardAccess,
} from "@/lib/authz";
import { getPriorities } from "@/lib/priorities";
import { getAccounts } from "@/lib/accounts";
import { getAssigneesForCards } from "@/lib/assignees";
import { formatCents } from "@/lib/money";
import { KanbanBoard, type KanbanCard } from "@/components/kanban/KanbanBoard";
import { NewCardButton } from "@/components/kanban/NewCardButton";
import { LiveRefresh } from "@/components/LiveRefresh";
import { maskHiddenCardFields } from "@/lib/card-field-projection";
import { budgetDisplayForCards } from "@/lib/card-budget-db";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boardId = Number(id);
  const { user, board } = await requireBoardAccess(boardId);
  const manage = canManageBoard(user, board);

  const statuses = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position));

  const priorities = await getPriorities();
  const accounts = await getAccounts();
  const priorityLabel = new Map(priorities.map((p) => [p.id, p.label]));
  const accountLabel = new Map(accounts.map((a) => [a.id, a.name]));
  const statusLabel = new Map(statuses.map((s) => [s.id, s.name]));

  const cardRows = await db
    .select({
      id: cards.id,
      statusId: cards.statusId,
      title: cards.title,
      number: cards.number,
      applicant: cards.applicant,
      priorityId: cards.priorityId,
      resubmittedAt: cards.resubmittedAt,
      deadline: cards.deadline,
      meeting: cards.meeting,
      budgetTitle: cards.budgetTitle,
      notes: cards.notes,
      instructionDate: cards.instructionDate,
      transferDate: cards.transferDate,
      approvedAmount: cards.approvedAmount,
      actualAmount: cards.actualAmount,
      accountId: cards.accountId,
    })
    .from(cards)
    .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt)))
    .orderBy(asc(cards.position), asc(cards.id));

  // Zugewiesene (mehrere) je Karte in EINER Query nachladen.
  const assigneeMap = await getAssigneesForCards(cardRows.map((r) => r.id));
  const budgetDisplay = await budgetDisplayForCards(cardRows.map((r) => r.id));

  const fieldRows = await db
    .select({ k: boardCardFields.fieldKey })
    .from(boardCardFields)
    .where(
      and(eq(boardCardFields.boardId, boardId), eq(boardCardFields.visible, true)),
    )
    .orderBy(asc(boardCardFields.position));
  const visible = fieldRows.map((r) => r.k);
  const visibleSet = new Set(visible);

  const kanbanCards: KanbanCard[] = cardRows.map((row) => {
    const r = maskHiddenCardFields(row, visibleSet);
    const assignees = (visibleSet.has("assignee") ? assigneeMap.get(r.id) ?? [] : []).map((a) => ({
      id: a.id,
      name: a.name || a.username,
      avatarPath: a.avatarPath,
    }));
    // Search text must obey the same visibility rules as displayed fields.
    const searchText = [
      r.title,
      r.number,
      r.applicant,
      visibleSet.has("budget_title") ? budgetDisplay.get(r.id)?.budgetTitle ?? r.budgetTitle : null,
      r.notes,
      r.deadline,
      r.meeting,
      r.instructionDate,
      r.transferDate,
      assignees.map((a) => a.name).join(" "),
      r.priorityId != null ? priorityLabel.get(r.priorityId) : null,
      visibleSet.has("account") ? budgetDisplay.get(r.id)?.accountName ?? (r.accountId != null ? accountLabel.get(r.accountId) : null) : null,
      statusLabel.get(r.statusId),
      r.approvedAmount != null ? formatCents(r.approvedAmount) : null,
      r.actualAmount != null ? formatCents(r.actualAmount) : null,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return {
      id: r.id,
      statusId: r.statusId,
      title: r.title,
      number: r.number,
      applicant: r.applicant,
      priorityId: r.priorityId,
      resubmitted: r.resubmittedAt != null,
      deadline: r.deadline,
      meeting: r.meeting,
      assignees,
      searchText,
    };
  });

  const members = await getBoardMemberUsers(board);

  return (
    <div>
      <LiveRefresh src={`/api/board/${boardId}/stream`} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/intern" className="text-sm text-brand-600">
            ← Alle Boards
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {board.name}
            {board.inventoryBoardId != null && (
              <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                System-Board · Leihvorgänge
              </span>
            )}
          </h1>
          {board.description && (
            <p className="text-sm text-slate-500">{board.description}</p>
          )}
        </div>
        <div className="flex w-full items-center gap-1.5 overflow-x-auto sm:w-auto sm:flex-wrap sm:gap-2 sm:overflow-visible">
          <NewCardButton
            boardId={boardId}
            visible={visible}
            priorities={priorities}
            accounts={accounts}
            defaultAccountId={board.defaultAccountId}
            currentUser={{
              id: user.id,
              username: user.username,
              name: user.name,
              avatarPath: user.avatarPath,
            }}
          />
          {board.doneStatusId != null && (
            <Link
              href={`/intern/board/${boardId}/archiv`}
              className="btn-secondary flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
            >
              🗄 Archiv
            </Link>
          )}
          <Link
            href={`/intern/board/${boardId}/statistik`}
            className="btn-secondary flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
          >
            📊 Statistik
          </Link>
          {manage &&
            (board.inventoryBoardId != null ? (
              <Link
                href={`/intern/inventar/${board.inventoryBoardId}/einstellungen`}
                className="btn-secondary flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
              >
                ⚙ Inventar-Einstellungen
              </Link>
            ) : (
              <Link
                href={`/intern/board/${boardId}/einstellungen`}
                className="btn-secondary flex-1 px-2 text-xs sm:flex-none sm:px-4 sm:text-sm"
              >
                ⚙ Einstellungen
              </Link>
            ))}
        </div>
      </div>

      {statuses.length === 0 ? (
        <p className="text-sm text-slate-500">
          Dieses Board hat noch keine Spalten. Lege welche in den Einstellungen
          an.
        </p>
      ) : (
        <KanbanBoard
          statuses={statuses.map((s) => ({
            id: s.id,
            name: s.name,
            isArchiveTrigger: s.isArchiveTrigger,
          }))}
          cards={kanbanCards}
          visible={visible}
          priorities={priorities}
          members={members}
        />
      )}
    </div>
  );
}
