// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, financeBoards, financePlanItems } from "@/lib/db/schema";
export type BudgetTitleOption = { value: string; label: string };
export type AccountBudgetCatalogs = Record<string, BudgetTitleOption[]>;
type Reader = Pick<typeof db, "select">;

/** Only expense codes/names, never plan amounts or finance access grants. */
export async function getFinanceBudgetTitles(financeBoardId: number | null, reader: Reader = db, lock = false): Promise<BudgetTitleOption[]> {
  if (financeBoardId == null) return [];
  const query = reader.select({ code: financePlanItems.haushaltstitel, title: financePlanItems.title }).from(financePlanItems)
    .where(trashAnd(activeRows.financePlanItems, and(eq(financePlanItems.financeBoardId, financeBoardId), eq(financePlanItems.kind, "expense")))).orderBy(asc(financePlanItems.position), asc(financePlanItems.id));
  const rows = await (lock ? query.for("share") : query);
  const titles = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.code.trim()) continue;
    const names = titles.get(row.code) ?? new Set<string>();
    if (row.title.trim()) names.add(row.title.trim());
    titles.set(row.code, names);
  }
  return [...titles].map(([value, names]) => ({ value, label: names.size ? `${value} — ${[...names].join(" / ")}` : value }));
}
export async function getAccountBudgetCatalogs(): Promise<AccountBudgetCatalogs> {
  const rows = await db.select({ id: accounts.id, financeBoardId: accounts.financeBoardId }).from(accounts).where(activeRows.accounts);
  const catalogs = new Map<number, BudgetTitleOption[]>();
  for (const row of rows) if (row.financeBoardId != null && !catalogs.has(row.financeBoardId)) catalogs.set(row.financeBoardId, await getFinanceBudgetTitles(row.financeBoardId));
  return Object.fromEntries(rows.map(row => [String(row.id), row.financeBoardId == null ? [] : catalogs.get(row.financeBoardId)!]));
}

/** Called inside the writer transaction; retain existing pairs without rewriting history. */
export async function validatePlannedBudgetTitles(reader: Reader, rows: { accountId?: number | null; budgetTitle: string }[], previous: { accountId?: number | null; budgetTitle: string }[]) {
  const ids = [...new Set(rows.flatMap(row => row.accountId ? [row.accountId] : []))];
  const sources = ids.length ? await reader.select().from(accounts).where(trashAnd(activeRows.accounts, inArray(accounts.id, ids))).for("share") : [];
  const catalogs = new Map<number, BudgetTitleOption[]>();
  // Coordinate against deletion of the selected finance board and its plan entries.
  const financeIds = [...new Set(sources.flatMap(row => row.financeBoardId ? [row.financeBoardId] : []))].sort((a,b) => a-b);
  if (financeIds.length) await reader.select({ id: financeBoards.id }).from(financeBoards).where(trashAnd(activeRows.financeBoards, inArray(financeBoards.id, financeIds))).orderBy(asc(financeBoards.id)).for("share");
  for (const source of sources) if (source.financeBoardId != null && !catalogs.has(source.financeBoardId)) catalogs.set(source.financeBoardId, await getFinanceBudgetTitles(source.financeBoardId, reader, true));
  const historical = new Map<string,number>();
  const key = (row:{accountId?:number|null;budgetTitle:string}) => JSON.stringify([row.accountId??null,row.budgetTitle]);
  for (const old of previous) historical.set(key(old),(historical.get(key(old))??0)+1);
  for (const row of rows) {
    const source = sources.find(source => source.id === row.accountId);
    if(source?.financeBoardId && catalogs.get(source.financeBoardId)?.some(option=>option.value===row.budgetTitle))continue;
    const retained=historical.get(key(row))??0;
    if(retained>0){historical.set(key(row),retained-1);continue;}
    if (!source?.financeBoardId) throw new Error("Dem ausgewählten Konto ist kein Finanzboard zugeordnet. Bitte die Zuordnung unter Admin → Konten einrichten.");
    if (!catalogs.get(source.financeBoardId)?.some(option => option.value === row.budgetTitle)) throw new Error("Bitte einen Haushaltstitel aus dem aktuellen Haushaltsplan des ausgewählten Kontos wählen.");
  }
}
export async function validateCashbookBudgetTitle(reader: Reader, financeBoardId: number | null, value: string, previous?: string) {
  if (value === previous) return;
  if (financeBoardId == null) throw new Error("Bitte in den Kassenbuch-Einstellungen ein Finanzboard für die Haushaltstitel zuordnen.");
  if (!(await getFinanceBudgetTitles(financeBoardId, reader, true)).some(option => option.value === value)) throw new Error("Bitte einen Haushaltstitel aus dem aktuellen Haushaltsplan des Kassenbuchs wählen.");
}
