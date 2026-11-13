// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, cards, cardBudgetPlans, cardBudgetPositions, cashbooks, cashbookEntries, financeBoardSources, users, type FinanceBoard } from "@/lib/db/schema";
import { cashbookPermission } from "./access";
import { effectiveCashbookEntries } from "./projection";
import type { AntragRow } from "@/lib/finance-data";
export async function cashbookFinanceProjection(fb: FinanceBoard, sourceIds: number[], fallbackAccounts: number[]) {
    const [book] = fb.cashbookId ? await db.select().from(cashbooks).where(eq(cashbooks.id, fb.cashbookId)) : [];
    const [owner] = await db.select().from(users).where(eq(users.id, fb.ownerId));
    if (!book || !owner || !["manage", "read", "write"].includes(await cashbookPermission(owner, book) ?? ""))
        throw new Error("Der Eigentümer der Finanzübersicht benötigt weiterhin Lesezugriff auf das verknüpfte Kassenbuch.");
    const posted = effectiveCashbookEntries(await db.select().from(cashbookEntries).where(eq(cashbookEntries.cashbookId, book.id))).filter(e => e.state === "posted");
    const actual = new Map<string, number>(), live = new Map<string, number>();
    for (const entry of posted) {
        const t = entry.data.budgetTitle;
        actual.set(t, (actual.get(t) ?? 0) + entry.data.amount);
        live.set(t, (live.get(t) ?? 0) + entry.data.amount);
    }
    const sources = sourceIds.length ? await db.select({ source: financeBoardSources, board: boards }).from(financeBoardSources).innerJoin(boards, eq(boards.id, financeBoardSources.boardId)).where(inArray(financeBoardSources.boardId, sourceIds)) : [];
    const relevantSources = sources.filter(s => s.source.financeBoardId === fb.id), sourceCards = sourceIds.length ? await db.select().from(cards).where(inArray(cards.boardId, sourceIds)) : [];
    const cardRows: AntragRow[] = [];
    for (const card of sourceCards) {
        const config = relevantSources.find(s => s.board.id === card.boardId);
        if (!config)
            continue;
        const accounts = config.source.accountId ? [config.source.accountId] : fallbackAccounts;
        const positions = card.budgetMode === "positions" ? await db.select().from(cardBudgetPositions).where(eq(cardBudgetPositions.cardId, card.id)) : [];
        if (!positions.length && (!card.accountId || !accounts.includes(card.accountId)) || positions.length && !positions.some(p => accounts.includes(p.accountId)))
            continue;
        const [plan] = await db.select().from(cardBudgetPlans).where(eq(cardBudgetPlans.cardId, card.id));
        const allocations = plan?.allocations.length ? plan.allocations : positions.length ? positions.filter(p => accounts.includes(p.accountId)).map(p => ({ budgetTitle: p.budgetTitle ?? "", amount: p.approvedAmount ?? 0 })) : [{ budgetTitle: card.budgetTitle ?? "", amount: card.approvedAmount ?? 0 }];
        const approved = new Map<string, number>();
        for (const row of allocations)
            if (row.budgetTitle)
                approved.set(row.budgetTitle, (approved.get(row.budgetTitle) ?? 0) + row.amount);
        const paid = new Map<string, number>();
        for (const entry of posted.filter(e => e.data.cardId === card.id))
            paid.set(entry.data.budgetTitle, (paid.get(entry.data.budgetTitle) ?? 0) + entry.data.amount);
        const expired = config.source.expiredStatusId === card.statusId;
        if (expired || card.statusId !== config.board.completedStatusId) {
            for (const [title, value] of paid)
                live.set(title, (live.get(title) ?? 0) - value);
            if (!expired)
                for (const [title, value] of approved)
                    live.set(title, (live.get(title) ?? 0) + value);
        }
        const titles = [...new Set([...approved.keys(), ...paid.keys()])];
        const breakdown = titles.map(title => ({ title, approved: approved.get(title) ?? 0, paid: paid.get(title) ?? 0, outstanding: (approved.get(title) ?? 0) - (paid.get(title) ?? 0) }));
        cardRows.push({ id: card.id, number: card.number, title: card.title, applicant: card.applicant, budgetTitle: titles.join(", "), decisionRef: card.decisionRef, instructionDate: card.instructionDate, transferDate: card.transferDate, accountId: card.accountId, approvedAmount: breakdown.reduce((s, r) => s + r.outstanding, 0), actualAmount: breakdown.reduce((s, r) => s + r.paid, 0), breakdown });
    }
    return { live, actual, cardRows };
}
