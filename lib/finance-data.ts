// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  cards,
  financeBoardAccounts,
  financeBoardExpenseAccounts,
  financePlanItems,
  type FinanceBoard,
} from "@/lib/db/schema";
import { resolveSourceBoards } from "@/lib/finance";

export type PlanItem = typeof financePlanItems.$inferSelect;

export type ExpenseLeaf = {
  id: number;
  haushaltstitel: string;
  title: string;
  planned: number | null;
  spent: number;
};
export type ExpenseRow = ExpenseLeaf & { children: ExpenseLeaf[] };

export type AntragRow = {
  id: number;
  number: string | null;
  budgetTitle: string | null;
  title: string;
  applicant: string;
  decisionRef: string | null;
  instructionDate: string | null;
  transferDate: string | null;
  approvedAmount: number | null;
  actualAmount: number | null;
  accountId: number | null;
};

export type FinanceData = {
  accountNames: string[];
  // Effektiv für die Ausgaben-Berechnung (Live & Tatsächlich) genutzte Konten.
  expenseAccountNames: string[];
  // true = eigener (abweichender) Konten-Override für die Ausgaben-Views aktiv.
  expenseAccountsOverridden: boolean;
  accessibleCount: number;
  inaccessible: { id: number; name: string }[];
  incomeTops: PlanItem[];
  expenseTops: PlanItem[];
  childrenOf: (id: number) => PlanItem[];
  cardRows: AntragRow[];
  live: ExpenseView;
  actual: ExpenseView;
};

export type ExpenseView = {
  rows: ExpenseRow[];
  unmatched: { title: string; spent: number }[];
  spentTotal: number; // dedupliziert (jeder Haushaltstitel einmal)
};

/** Baut die Ausgaben-Rollup-Zeilen (Oberpunkt summiert eigene + Unterpunkte). */
export function buildRows(
  tops: PlanItem[],
  childrenOf: (id: number) => PlanItem[],
  spentByTitle: Map<string, number>,
): ExpenseView {
  const used = new Set<string>();
  const rows: ExpenseRow[] = tops.map((top) => {
    const kids = childrenOf(top.id).map((k) => {
      if (k.haushaltstitel) used.add(k.haushaltstitel);
      return {
        id: k.id,
        haushaltstitel: k.haushaltstitel,
        title: k.title,
        planned: k.plannedAmount,
        spent: k.haushaltstitel ? (spentByTitle.get(k.haushaltstitel) ?? 0) : 0,
      };
    });
    if (top.haushaltstitel) used.add(top.haushaltstitel);
    // Summe über die DISTINCT Haushaltstitel im Teilbaum (jeder Titel nur
    // einmal) — sonst zählt ein an Ober- UND Unterpunkt gleicher Titel doppelt.
    const titles = new Set<string>();
    if (top.haushaltstitel) titles.add(top.haushaltstitel);
    for (const k of kids) if (k.haushaltstitel) titles.add(k.haushaltstitel);
    const total = [...titles].reduce((s, t) => s + (spentByTitle.get(t) ?? 0), 0);
    return {
      id: top.id,
      haushaltstitel: top.haushaltstitel,
      title: top.title,
      planned: top.plannedAmount,
      spent: total,
      children: kids,
    };
  });
  // Gesamt-Ausgaben: jeder genutzte Haushaltstitel GENAU EINMAL (auch wenn er
  // an mehreren Oberpunkten hängt) — sonst Doppelzählung in der Summe.
  const spentTotal = [...used].reduce(
    (s, t) => s + (spentByTitle.get(t) ?? 0),
    0,
  );
  const unmatched = [...spentByTitle.entries()]
    .filter(([t]) => t && !used.has(t))
    .map(([title, spent]) => ({ title, spent }));
  return { rows, unmatched, spentTotal };
}

/** Lädt alle Daten der vier Finanz-Views (für Anzeige und Export). */
export async function loadFinanceData(fb: FinanceBoard): Promise<FinanceData> {
  // Betroffene Konten (n:m) inkl. Namen — Karten mit EINEM dieser Konten zählen.
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(financeBoardAccounts)
    .innerJoin(accounts, eq(accounts.id, financeBoardAccounts.accountId))
    .where(eq(financeBoardAccounts.financeBoardId, fb.id))
    .orderBy(asc(accounts.name));
  const accountIds = accountRows.map((a) => a.id);
  const accountIdSet = new Set(accountIds);

  // Optionaler Konten-Override für die Ausgaben-Views — nur Konten zählen, die
  // weiterhin betroffene Konten sind (stale Einträge werden ignoriert). Ohne
  // gültigen Override gelten alle betroffenen Konten (= bisheriges Verhalten).
  const expenseAccountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(financeBoardExpenseAccounts)
    .innerJoin(accounts, eq(accounts.id, financeBoardExpenseAccounts.accountId))
    .where(eq(financeBoardExpenseAccounts.financeBoardId, fb.id))
    .orderBy(asc(accounts.name));
  const validOverride = expenseAccountRows.filter((a) => accountIdSet.has(a.id));
  const expenseAccountsOverridden = validOverride.length > 0;
  const expenseSet = new Set(
    expenseAccountsOverridden ? validOverride.map((a) => a.id) : accountIds,
  );

  const { accessible, inaccessible } = await resolveSourceBoards(fb);
  const accessibleIds = accessible.map((s) => s.id);

  const items = await db
    .select()
    .from(financePlanItems)
    .where(eq(financePlanItems.financeBoardId, fb.id))
    .orderBy(asc(financePlanItems.position));
  const tops = items.filter((i) => i.parentId == null);
  const childrenOf = (pid: number) => items.filter((i) => i.parentId === pid);
  const incomeTops = tops.filter((i) => i.kind === "income");
  const expenseTops = tops.filter((i) => i.kind === "expense");

  const cardRows: AntragRow[] =
    accessibleIds.length && accountIds.length
      ? await db
          .select({
            id: cards.id,
            number: cards.number,
            budgetTitle: cards.budgetTitle,
            title: cards.title,
            applicant: cards.applicant,
            decisionRef: cards.decisionRef,
            instructionDate: cards.instructionDate,
            transferDate: cards.transferDate,
            approvedAmount: cards.approvedAmount,
            actualAmount: cards.actualAmount,
            accountId: cards.accountId,
          })
          .from(cards)
          .where(
            and(
              inArray(cards.boardId, accessibleIds),
              inArray(cards.accountId, accountIds),
              isNotNull(cards.budgetTitle),
              ne(cards.budgetTitle, ""),
            ),
          )
      : [];

  const liveByTitle = new Map<string, number>();
  const actualByTitle = new Map<string, number>();
  for (const c of cardRows) {
    const t = c.budgetTitle ?? "";
    if (!t) continue;
    // Ausgaben-Berechnung nur für die (ggf. eingeschränkten) Ausgaben-Konten.
    if (c.accountId == null || !expenseSet.has(c.accountId)) continue;
    const live = c.actualAmount ?? c.approvedAmount ?? 0;
    liveByTitle.set(t, (liveByTitle.get(t) ?? 0) + live);
    if (c.actualAmount != null) {
      actualByTitle.set(t, (actualByTitle.get(t) ?? 0) + c.actualAmount);
    }
  }

  return {
    accountNames: accountRows.map((a) => a.name),
    expenseAccountNames: expenseAccountsOverridden
      ? validOverride.map((a) => a.name)
      : accountRows.map((a) => a.name),
    expenseAccountsOverridden,
    accessibleCount: accessible.length,
    inaccessible,
    incomeTops,
    expenseTops,
    childrenOf,
    cardRows,
    live: buildRows(expenseTops, childrenOf, liveByTitle),
    actual: buildRows(expenseTops, childrenOf, actualByTitle),
  };
}
