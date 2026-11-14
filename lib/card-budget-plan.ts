// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { MAX_BUDGET_POSITIONS } from "./card-budget";
import { formatCents, MAX_AMOUNT_CENTS, parseEuroToCents } from "./money";
import { sanitizeSingleLine } from "./text";

export class BudgetPlanError extends Error {}

export type BudgetPlanAllocation = { amount: number; budgetTitle: string; accountId?:number|null };
export type BudgetPlanDraft = { amount: string; budgetTitle: string; accountId?:number|null };

/** Validate the entire draft before writing; blank or partial rows are never silently dropped. */
export function parseBudgetPlan(input: unknown, defaultAccountId?:number|null): BudgetPlanAllocation[] {
  if (!Array.isArray(input) || input.length > MAX_BUDGET_POSITIONS) {
    throw new BudgetPlanError(`Bitte höchstens ${MAX_BUDGET_POSITIONS} Haushaltstitel einplanen.`);
  }
  return input.map((row, index) => {
    if (!row || typeof row.amount !== "string" || typeof row.budgetTitle !== "string") {
      throw new BudgetPlanError(`Zeile ${index + 1}: Betrag und Haushaltstitel erforderlich.`);
    }
    const amount = parseEuroToCents(row.amount);
    const budgetTitle = sanitizeSingleLine(row.budgetTitle);
    if (amount == null || amount > MAX_AMOUNT_CENTS) throw new BudgetPlanError(`Zeile ${index + 1}: Bitte einen gültigen Betrag eingeben.`);
    if (!budgetTitle || budgetTitle.length > 200) throw new BudgetPlanError(`Zeile ${index + 1}: Haushaltstitel mit höchstens 200 Zeichen erforderlich.`);
    const accountId = Object.hasOwn(row,"accountId") ? row.accountId : defaultAccountId;
    if (accountId != null && (!Number.isSafeInteger(accountId) || accountId<1 || accountId>2147483647)) throw new BudgetPlanError(`Zeile ${index+1}: Bitte ein gültiges Konto auswählen.`);
    return { amount, budgetTitle, ...(accountId !== undefined ? {accountId} : {}) };
  });
}

/** Preserve row order and each amount/title pair, including repeated titles. */
export function budgetPlanMotionValues(rows: BudgetPlanAllocation[]): Record<string, string> {
  const pairs = rows.map(row => `${formatCents(row.amount)} aus Titel ${row.budgetTitle}`);
  return {
    planned_budget: pairs.length > 1 ? `${pairs.slice(0, -1).join(", ")} und ${pairs.at(-1)}` : pairs[0] || "—",
    planned_budget_total: rows.length ? formatCents(rows.reduce((sum, row) => sum + row.amount, 0)) : "—",
    planned_budget_titles: rows.map(row => row.budgetTitle).join(", ") || "—",
  };
}
