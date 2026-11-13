// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { accounts, boards, users, financeBoards, financeBoardSources } from "@/lib/db/schema";
import { requireFinanceManage } from "@/lib/finance";
import { cashbookPermission, requireCashbook } from "@/lib/cashbook/access";
type State = { error?: string; success?: string };
export async function linkFinanceCashbookAction(id: number, _previous: State, data: FormData): Promise<State> {
  const { user, fb } = await requireFinanceManage(id);
  const bookId = Number(data.get("cashbookId")) || null;
  try {
    if (bookId) {
      const sources = await db.select().from(financeBoardSources).where(eq(financeBoardSources.financeBoardId, id));
      if (sources.some(source => !source.accountId)) throw new Error("Bitte zuerst für jedes Quell-Antragsboard ein Konto festlegen.");
      const { book, permission } = await requireCashbook(user, bookId);
      if (permission === "office") throw new Error("Zum Verknüpfen ist mindestens Lesezugriff erforderlich.");
      const [owner] = await db.select().from(users).where(eq(users.id, fb.ownerId));
      if (!owner || !["manage", "read", "write"].includes(await cashbookPermission(owner, book) ?? "")) throw new Error("Der Eigentümer der Finanzübersicht benötigt Lesezugriff auf das Kassenbuch.");
      for (const source of sources) {
        const [board] = await db.select().from(boards).where(eq(boards.id, source.boardId));
        if (!board?.isApplicationBoard) throw new Error("Bitte ausschließlich Antragsboards als Quellen verwenden.");
      }
    }
    await db.update(financeBoards).set({ cashbookId: bookId }).where(eq(financeBoards.id, id));
    revalidatePath(`/finanzen/${id}`, "layout");
    return { success: "Gespeichert." };
  } catch (error) {
    return { error: error instanceof Error && !("cause" in error) ? error.message : "Verknüpfung konnte nicht gespeichert werden." };
  }
}
export async function financeSourceAccountAction(id: number, boardId: number, _previous: State, data: FormData): Promise<State> {
  const { fb } = await requireFinanceManage(id);
  const accountId = Number(data.get("accountId")) || null;
  if (fb.cashbookId && !accountId) return { error: "Bei verknüpftem Kassenbuch ist ein Konto je Antragsboard erforderlich." };
  if (accountId && !(await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId))).length) return { error: "Konto nicht verfügbar." };
  await db.update(financeBoardSources).set({ accountId }).where(and(eq(financeBoardSources.financeBoardId, id), eq(financeBoardSources.boardId, boardId)));
  revalidatePath(`/finanzen/${id}`, "layout");
  return { success: "Gespeichert." };
}
