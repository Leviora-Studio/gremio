// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cardAssignees, cards, type User } from "@/lib/db/schema";
import { getAccessibleBoards } from "@/lib/authz";
import { getAccounts } from "@/lib/accounts";
import { getPriorities } from "@/lib/priorities";
import { budgetDisplayForCards } from "@/lib/card-budget-db";

export type TaskCardRow = {
  id: number;
  boardId: number;
  boardName: string;
  statusId: number;
  statusName: string;
  title: string;
  number: string | null;
  applicant: string;
  priorityId: number | null;
  deadline: string | null;
  meeting: string | null;
  budgetTitle: string | null;
  accountName: string | null;
  approvedAmount: number | null;
  actualAmount: number | null;
  notes: string | null;
  statusPosition: number;
};

export type TaskOverviewData = {
  cards: TaskCardRow[];
  boards: { id: number; name: string }[];
  statusesByBoard: Record<number, { id: number; name: string }[]>;
  priorities: { id: number; label: string; color: string }[];
};

/** Lädt alle dem Nutzer zugewiesenen (nicht archivierten) Karten + Metadaten. */
export async function loadTaskOverviewData(
  user: User,
): Promise<TaskOverviewData> {
  const boards = await getAccessibleBoards(user);
  const boardIds = boards.map((b) => b.id);

  const accounts = await getAccounts();
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const priorities = await getPriorities();

  const statusRows = boardIds.length
    ? await db
        .select({
          id: boardStatuses.id,
          boardId: boardStatuses.boardId,
          name: boardStatuses.name,
          position: boardStatuses.position,
        })
        .from(boardStatuses)
        .where(inArray(boardStatuses.boardId, boardIds))
        .orderBy(asc(boardStatuses.position))
    : [];
  const statusesByBoard: Record<number, { id: number; name: string }[]> = {};
  const statusPos = new Map<number, number>();
  const statusName = new Map<number, string>();
  for (const s of statusRows) {
    (statusesByBoard[s.boardId] ??= []).push({ id: s.id, name: s.name });
    statusPos.set(s.id, s.position);
    statusName.set(s.id, s.name);
  }

  const raw = boardIds.length
    ? await db
        .select({
          id: cards.id,
          boardId: cards.boardId,
          statusId: cards.statusId,
          title: cards.title,
          number: cards.number,
          applicant: cards.applicant,
          priorityId: cards.priorityId,
          deadline: cards.deadline,
          meeting: cards.meeting,
          budgetTitle: cards.budgetTitle,
          accountId: cards.accountId,
          approvedAmount: cards.approvedAmount,
          actualAmount: cards.actualAmount,
          notes: cards.notes,
        })
        .from(cards)
        .where(
          and(
            // Karten, in denen der Nutzer zu den Zugewiesenen gehört (n:m).
            inArray(
              cards.id,
              db
                .select({ id: cardAssignees.cardId })
                .from(cardAssignees)
                .where(eq(cardAssignees.userId, user.id)),
            ),
            isNull(cards.archivedAt),
            inArray(cards.boardId, boardIds),
          ),
        )
    : [];

  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const budgetDisplay = await budgetDisplayForCards(raw.map((c) => c.id));
  const cardRows: TaskCardRow[] = raw.map((c) => ({
    id: c.id,
    boardId: c.boardId,
    boardName: boardName.get(c.boardId) ?? "?",
    statusId: c.statusId,
    statusName: statusName.get(c.statusId) ?? "?",
    title: c.title,
    number: c.number,
    applicant: c.applicant,
    priorityId: c.priorityId,
    deadline: c.deadline,
    meeting: c.meeting,
    budgetTitle: budgetDisplay.get(c.id)?.budgetTitle ?? c.budgetTitle,
    accountName: budgetDisplay.get(c.id)?.accountName ?? (c.accountId ? (accountName.get(c.accountId) ?? null) : null),
    approvedAmount: c.approvedAmount,
    actualAmount: c.actualAmount,
    notes: c.notes,
    statusPosition: statusPos.get(c.statusId) ?? 0,
  }));

  return {
    cards: cardRows,
    boards: boards.map((b) => ({ id: b.id, name: b.name })),
    statusesByBoard,
    priorities: priorities.map((p) => ({
      id: p.id,
      label: p.label,
      color: p.color,
    })),
  };
}
