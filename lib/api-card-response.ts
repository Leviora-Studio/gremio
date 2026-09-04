// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cardAssignees, cards } from "@/lib/db/schema";
import { serializeCard } from "@/lib/api";
import { BUDGET_FIELDS } from "@/lib/card-budget";
import { loadBudgetPositions } from "@/lib/card-budget-db";

/** Caller must authorize board access first. Read revision, totals and rows from one snapshot. */
export async function serializeApiCardDetail(cardId: number, visible: Set<string>, boardName?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ card: cards, statusName: boardStatuses.name })
      .from(cards).innerJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
      .where(eq(cards.id, cardId));
    if (!row) return null;
    const assignees = await tx.select({ userId: cardAssignees.userId })
      .from(cardAssignees).where(eq(cardAssignees.cardId, cardId));
    const budgetPositions = (await loadBudgetPositions(cardId, tx)).map((position) => {
      const out: Record<string, unknown> = { id: position.id, position: position.position };
      for (const [key, field] of Object.entries(BUDGET_FIELDS)) {
        if (visible.has(field)) out[key] = position[key as keyof typeof position];
      }
      if (visible.has("budget_title")) out.description = position.description;
      return out;
    });
    return {
      card: serializeCard(row.card, {
        ...(boardName !== undefined ? { boardName, statusName: row.statusName } : {}),
        assigneeUserIds: assignees.map((a) => a.userId),
      }, visible),
      budgetPositions,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
