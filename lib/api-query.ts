// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { z } from "zod";
import { NextResponse } from "next/server";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  isNotNull,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardCardFields,
  boards,
  boardStatuses,
  cardAssignees,
  cards,
} from "@/lib/db/schema";
import { getAccessibleBoards } from "@/lib/authz";
import { getAssigneeIdsForCards } from "@/lib/assignees";
import {
  apiError,
  serializeCard,
  tokenAllowsBoard,
  type ApiContext,
} from "@/lib/api";

const int = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(2147483647));
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const cardQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    boardId: int.optional(),
    statusId: int.optional(),
    priorityId: int.optional(),
    accountId: int.optional(),
    assigneeUserId: int.optional(),
    unassigned: z.enum(["true", "false"]).optional(),
    archived: z.enum(["true", "false", "all"]).optional(),
    deadlineBefore: date.optional(),
    deadlineAfter: date.optional(),
    overdue: z.enum(["true", "false"]).optional(),
    limit: int.pipe(z.number().max(100)).optional(),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(1000000))
      .optional(),
    sort: z.enum(["position", "updated", "deadline"]).optional(),
  })
  .strict();
export const pageQuerySchema = z.object({
  limit: int.pipe(z.number().max(100)).default("50"),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(1000000))
    .default("0"),
});
export function pagination(req: Request) {
  return pageQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
}

function fieldVisible(key: string): SQL {
  return sql`exists (select 1 from ${boardCardFields} where ${boardCardFields.boardId} = ${cards.boardId} and ${boardCardFields.fieldKey} = ${key} and ${boardCardFields.visible} = true)`;
}

/** Optional pagination on legacy lists; cross-board search is always bounded. */
export async function queryApiCards(
  req: Request,
  ctx: ApiContext,
  options: { boardId?: number; mine?: boolean; paginated?: boolean } = {},
) {
  const parsed = cardQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success)
    return apiError(400, "Ungültige Suchparameter.", {
      issues: parsed.error.issues,
    });
  const p = parsed.data;
  if (options.boardId && p.boardId && p.boardId !== options.boardId)
    return apiError(400, "boardId widerspricht dem Pfad.");
  const accessible = (await getAccessibleBoards(ctx.user)).filter((b) =>
    tokenAllowsBoard(ctx, b.id),
  );
  const boardId = options.boardId ?? p.boardId;
  if (boardId && !accessible.some((b) => b.id === boardId))
    return apiError(404, "Board nicht gefunden.");
  const ids = boardId ? [boardId] : accessible.map((b) => b.id);
  const paged = options.paginated || p.limit != null || p.offset != null;
  const limit = p.limit ?? 50,
    offset = p.offset ?? 0;
  if (!ids.length)
    return NextResponse.json({
      cards: [],
      ...(paged ? { pagination: { limit, offset, hasMore: false } } : {}),
    });
  const conditions: SQL[] = [inArray(cards.boardId, ids)];
  if (p.archived === "true") conditions.push(isNotNull(cards.archivedAt));
  else if (p.archived !== "all") conditions.push(isNull(cards.archivedAt));
  if (p.statusId) conditions.push(eq(cards.statusId, p.statusId));
  if (p.priorityId)
    conditions.push(
      fieldVisible("priority"),
      eq(cards.priorityId, p.priorityId),
    );
  if (p.accountId)
    conditions.push(
      fieldVisible("account"),
      sql`(${cards.accountId} = ${p.accountId} or exists (select 1 from card_budget_positions bp where bp.card_id = ${cards.id} and bp.account_id = ${p.accountId}))`,
    );
  if (options.mine)
    conditions.push(
      sql`exists (select 1 from ${cardAssignees} where ${cardAssignees.cardId} = ${cards.id} and ${cardAssignees.userId} = ${ctx.user.id})`,
    );
  if (p.assigneeUserId)
    conditions.push(
      fieldVisible("assignee"),
      sql`exists (select 1 from ${cardAssignees} where ${cardAssignees.cardId} = ${cards.id} and ${cardAssignees.userId} = ${p.assigneeUserId})`,
    );
  if (p.unassigned)
    conditions.push(
      fieldVisible("assignee"),
      sql`(not exists (select 1 from ${cardAssignees} where ${cardAssignees.cardId} = ${cards.id})) = ${p.unassigned === "true"}`,
    );
  if (p.deadlineBefore)
    conditions.push(
      fieldVisible("deadline"),
      sql`${cards.deadline} < ${p.deadlineBefore}`,
    );
  if (p.deadlineAfter)
    conditions.push(
      fieldVisible("deadline"),
      sql`${cards.deadline} > ${p.deadlineAfter}`,
    );
  if (p.overdue)
    conditions.push(
      fieldVisible("deadline"),
      sql`coalesce((${cards.deadline} < to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD') and (${boards.doneStatusId} is null or ${cards.statusId} <> ${boards.doneStatusId}) and ${cards.archivedAt} is null), false) = ${p.overdue === "true"}`,
    );
  if (p.q) {
    const pattern = `%${p.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(cards.title, pattern),
        ...(
          [
            ["number", cards.number],
            ["applicant", cards.applicant],
            ["notes", cards.notes],
            ["budget_title", cards.budgetTitle],
          ] as const
        ).map(([key, column]) =>
          and(fieldVisible(key), ilike(column, pattern)),
        ),
      )!,
    );
  }
  const ordering =
    p.sort === "updated"
      ? [desc(cards.updatedAt), desc(cards.id)]
      : p.sort === "deadline"
        ? [
            sql`case when ${fieldVisible("deadline")} then ${cards.deadline} end asc nulls last`,
            asc(cards.id),
          ]
        : [
            asc(boards.id),
            asc(boardStatuses.position),
            asc(cards.position),
            asc(cards.id),
          ];
  const query = db
    .select({
      card: cards,
      boardName: boards.name,
      statusName: boardStatuses.name,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(and(...conditions))
    .orderBy(...ordering)
    .$dynamic();
  const rows = await (paged ? query.limit(limit + 1).offset(offset) : query);
  const hasMore = paged && rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;
  const fields = await db
    .select()
    .from(boardCardFields)
    .where(
      and(
        inArray(boardCardFields.boardId, ids),
        eq(boardCardFields.visible, true),
      ),
    );
  const visible = new Map(
    ids.map((id) => [
      id,
      new Set(fields.filter((f) => f.boardId === id).map((f) => f.fieldKey)),
    ]),
  );
  const assignees = await getAssigneeIdsForCards(
    selected.map((r) => r.card.id),
  );
  return NextResponse.json({
    cards: selected.map((r) =>
      serializeCard(
        r.card,
        {
          boardName: r.boardName,
          statusName: r.statusName,
          assigneeUserIds: assignees.get(r.card.id) ?? [],
        },
        visible.get(r.card.boardId),
      ),
    ),
    ...(paged ? { pagination: { limit, offset, hasMore } } : {}),
  });
}
