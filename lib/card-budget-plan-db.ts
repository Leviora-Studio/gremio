// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { validatePlannedBudgetTitles } from "./budget-title-catalog";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, cards, accounts, cardBudgetPlans, cardBudgetPlanCorrections, cardActivity, type User } from "@/lib/db/schema";
import { canEditBoard } from "@/lib/authz";
import { BudgetPlanError, parseBudgetPlan, type BudgetPlanAllocation } from "./card-budget-plan";
import { CardFrozenError } from "./card-freeze";
import { sanitizeMultiLine } from "./text";
import { formatCents } from "./money";

export type BudgetPlanWriteOptions = { confirmAccountChange?:boolean; correction?: {reason:string;confirmation:string} };

/** All planning writes, including append-only corrections, serialize on the card. */
export async function writeBudgetPlan(user: User, cardId: number, revision: number, input: unknown, options:BudgetPlanWriteOptions = {}) {
  if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647 || !Number.isSafeInteger(revision) || revision < 0) throw new BudgetPlanError("Ungültige Einplanung.");
  return db.transaction(async tx => {
    const [source] = await tx.select({ board: boards }).from(cards).innerJoin(boards, trashAnd(activeRows.boards, eq(boards.id, cards.boardId))).where(trashAnd(activeRows.cards, eq(cards.id, cardId)));
    if (!source) throw new BudgetPlanError("Karte nicht verfügbar.");
    const [board] = await tx.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.id, source.board.id))).for("share");
    if (!board?.isApplicationBoard || board.inventoryBoardId != null || !await canEditBoard(user, board)) throw new BudgetPlanError("Zum Einplanen ist Schreibzugriff auf ein aktives Antragsboard erforderlich.");
    const [card] = await tx.select().from(cards).where(trashAnd(activeRows.cards, eq(cards.id,cardId))).for("update");
    if (!card || card.boardId !== board.id) throw new BudgetPlanError("Karte wurde geändert. Bitte neu laden.");
    const reason = typeof options.correction?.reason === "string" ? sanitizeMultiLine(options.correction.reason).trim() : "";
    if (card.lockedAt && !options.correction) throw new CardFrozenError();
    if (options.correction && (!card.lockedAt || options.correction.confirmation !== "BESTÄTIGEN" || !reason || reason.length>4000)) throw new BudgetPlanError("Korrektureinträge erfordern eine gesperrte Karte, eine Begründung und die Eingabe BESTÄTIGEN.");
    const [current] = await tx.select().from(cardBudgetPlans).where(trashAnd(activeRows.cardBudgetPlans, eq(cardBudgetPlans.cardId, cardId)));
    if ((current?.revision ?? 0) !== revision) throw new BudgetPlanError("Die Einplanung wurde zwischenzeitlich geändert. Bitte neu laden; dein Entwurf bleibt erhalten.");
    const allocations = parseBudgetPlan(input,board.defaultAccountId ?? (board.legacyFinanceFields ? card.accountId : null));
    const accountIds = [...new Set(allocations.flatMap(row=>row.accountId ? [row.accountId] : []))];
    const accountOptions = accountIds.length ? await tx.select().from(accounts).where(trashAnd(activeRows.accounts, inArray(accounts.id,accountIds))) : [];
    if (allocations.some(row=>!row.accountId || !accountOptions.some(account=>account.id===row.accountId))) throw new BudgetPlanError("Bitte in jeder Zeile ein vorhandenes Konto auswählen.");
    const before = current?.allocations ?? [];
    const accountChanged = allocations.some((row,index)=>row.accountId !== (before[index]?.accountId ?? (board.defaultAccountId ?? (board.legacyFinanceFields ? card.accountId : null))));
    if (accountChanged && options.confirmAccountChange !== true) throw new BudgetPlanError("Bitte den Wechsel des Kontos ausdrücklich bestätigen.");
    if (JSON.stringify(allocations)===JSON.stringify(before)) throw new BudgetPlanError("Bitte mindestens einen Betrag, ein Konto oder einen Haushaltstitel ändern.");
    try { await validatePlannedBudgetTitles(tx, allocations, before); }
    catch (error) { throw new BudgetPlanError(error instanceof Error ? error.message : "Bitte den Haushaltstitel prüfen."); }
    const nextRevision = revision + 1;
    if (card.lockedAt) await tx.insert(cardBudgetPlanCorrections).values({cardId,revision:nextRevision,beforeAllocations:before,afterAllocations:allocations,reason,userId:user.id});
    if (current) await tx.update(cardBudgetPlans).set({allocations,revision:nextRevision}).where(eq(cardBudgetPlans.cardId,cardId));
    else await tx.insert(cardBudgetPlans).values({cardId,allocations,revision:nextRevision});
    await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
    const accountNames = await tx.select().from(accounts).where(activeRows.accounts);
    const describe = (rows:BudgetPlanAllocation[])=> rows.length ? rows.map((row,index)=>`${index+1}. ${formatCents(row.amount)} · Konto ${accountNames.find(a=>a.id===row.accountId)?.name ?? "nicht angegeben"} · HT ${row.budgetTitle}`).join("\n") : "Keine Einplanung";
    await tx.insert(cardActivity).values({ cardId, userId: user.id, type: card.lockedAt ? "budget_plan_correction" : "budget_plan", detail: `${card.lockedAt ? "Korrektureintrag" : "Haushaltstitel-Einplanung aktualisiert"}${reason ? `\nBegründung: ${reason}` : ""}\nVorher:\n${describe(before)}\nNachher:\n${describe(allocations)}` });
    return nextRevision;
  });
}
