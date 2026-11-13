// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, cards, cardBudgetPlans, cardActivity, type User } from "@/lib/db/schema";
import { canEditBoard } from "@/lib/authz";
import { BudgetPlanError, parseBudgetPlan } from "./card-budget-plan";

/** Separate from accounting positions: planning never changes card amounts or account allocations. */
export async function writeBudgetPlan(user: User, cardId: number, revision: number, input: unknown) {
  if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647 || !Number.isSafeInteger(revision) || revision < 0) {
    throw new BudgetPlanError("Ungültige Einplanung.");
  }
  const allocations = parseBudgetPlan(input);
  return db.transaction(async tx => {
    const [source] = await tx.select({ board: boards }).from(cards).innerJoin(boards, eq(boards.id, cards.boardId)).where(eq(cards.id, cardId));
    if (!source) throw new BudgetPlanError("Karte nicht verfügbar.");
    // Board first, then card: serialize with board settings and card movement/deletion.
    const [board] = await tx.select().from(boards).where(eq(boards.id, source.board.id)).for("share");
    if (!board?.isApplicationBoard || board.inventoryBoardId != null || !await canEditBoard(user, board)) {
      throw new BudgetPlanError("Zum Einplanen ist Schreibzugriff auf ein aktives Antragsboard erforderlich.");
    }
    const [card] = await tx.select({ id: cards.id }).from(cards).where(and(eq(cards.id, cardId), eq(cards.boardId, board.id))).for("update");
    if (!card) throw new BudgetPlanError("Karte wurde geändert. Bitte neu laden.");
    const [current] = await tx.select().from(cardBudgetPlans).where(eq(cardBudgetPlans.cardId, cardId));
    if ((current?.revision ?? 0) !== revision) throw new BudgetPlanError("Die Einplanung wurde zwischenzeitlich geändert. Bitte neu laden; dein Entwurf bleibt erhalten.");
    const nextRevision = revision + 1;
    await tx.insert(cardBudgetPlans).values({ cardId, allocations, revision: nextRevision })
      .onConflictDoUpdate({ target: cardBudgetPlans.cardId, set: { allocations, revision: nextRevision } });
    await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
    await tx.insert(cardActivity).values({ cardId, userId: user.id, type: "budget_plan", detail: "Haushaltstitel-Einplanung aktualisiert" });
    return nextRevision;
  });
}
