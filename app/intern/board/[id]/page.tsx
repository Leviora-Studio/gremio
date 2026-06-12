// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cards,
  boardCardFields,
  boardStatuses,
  users,
} from "@/lib/db/schema";
import {
  canManageBoard,
  getBoardMemberUsers,
  requireBoardAccess,
} from "@/lib/authz";
import { getPriorities } from "@/lib/priorities";
import { getAccounts } from "@/lib/accounts";
import { formatCents } from "@/lib/money";
import { KanbanBoard, type KanbanCard } from "@/components/kanban/KanbanBoard";
import { NewCardButton } from "@/components/kanban/NewCardButton";
import { LiveRefresh } from "@/components/LiveRefresh";

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
      assigneeId: users.id,
      assigneeName: sql<string | null>`coalesce(${users.name}, ${users.username})`,
      assigneeAvatarPath: users.avatarPath,
    })
    .from(cards)
    .leftJoin(users, eq(users.id, cards.assigneeUserId))
    .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt)))
    .orderBy(asc(cards.position), asc(cards.id));

  const kanbanCards: KanbanCard[] = cardRows.map((r) => {
    // Durchsuchbarer Text aus ALLEN Feldern (lowercase, serverseitig).
    const searchText = [
      r.title,
      r.number,
      r.applicant,
      r.budgetTitle,
      r.notes,
      r.deadline,
      r.meeting,
      r.instructionDate,
      r.transferDate,
      r.assigneeName,
      r.priorityId != null ? priorityLabel.get(r.priorityId) : null,
      r.accountId != null ? accountLabel.get(r.accountId) : null,
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
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      assigneeAvatarPath: r.assigneeAvatarPath,
      searchText,
    };
  });

  const fieldRows = await db
    .select({ k: boardCardFields.fieldKey })
    .from(boardCardFields)
    .where(
      and(eq(boardCardFields.boardId, boardId), eq(boardCardFields.visible, true)),
    )
    .orderBy(asc(boardCardFields.position));
  const visible = fieldRows.map((r) => r.k);
  const members = await getBoardMemberUsers(board);

  return (
    <div>
      <LiveRefresh src={`/api/board/${boardId}/stream`} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/intern" className="text-sm text-brand-600">
            ← Alle Boards
          </Link>
          <h1 className="text-2xl font-bold">{board.name}</h1>
          {board.description && (
            <p className="text-sm text-slate-500">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            canManage={manage}
          />
          {board.doneStatusId != null && (
            <Link
              href={`/intern/board/${boardId}/archiv`}
              className="btn-secondary"
            >
              🗄 Archiv
            </Link>
          )}
          {manage && (
            <>
              <Link
                href={`/intern/board/${boardId}/statistik`}
                className="btn-secondary"
              >
                📊 Statistik
              </Link>
              <Link
                href={`/intern/board/${boardId}/einstellungen`}
                className="btn-secondary"
              >
                ⚙ Einstellungen
              </Link>
            </>
          )}
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
