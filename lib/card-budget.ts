import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { sanitizeSingleLine } from "@/lib/text";

const text = (max: number) => z.preprocess((v) => typeof v === "string" ? sanitizeSingleLine(v) : v, z.string().max(max).nullable());
const amount = z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullable();
export const budgetPositionSchema = z.object({
  id: z.string().uuid(), budgetTitle: text(60), description: text(1000),
  accountId: z.number().int().positive({ message: "Jede Position benötigt ein Konto." }).max(2147483647),
  requestedAmount: amount, approvedAmount: amount, actualAmount: amount,
}).strict();
export const budgetPositionsSchema = z.array(budgetPositionSchema).min(1).refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, "Positions-IDs dürfen nicht doppelt vorkommen.");
export const budgetPositionsInputSchema = z.array(budgetPositionSchema.partial({ requestedAmount: true, approvedAmount: true, actualAmount: true })).min(1).refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, "Positions-IDs dürfen nicht doppelt vorkommen.");
export type BudgetPosition = z.infer<typeof budgetPositionSchema>;
/** Explicit editor payload: database rows also carry read-only cardId/position. */
export function editableBudgetPosition(row: BudgetPosition): BudgetPosition {
  return {
    id: row.id, budgetTitle: row.budgetTitle, description: row.description,
    accountId: row.accountId, requestedAmount: row.requestedAmount,
    approvedAmount: row.approvedAmount, actualAmount: row.actualAmount,
  };
}
export const BUDGET_FIELDS = { budgetTitle: "budget_title", accountId: "account", requestedAmount: "requested_amount", approvedAmount: "approved_amount", actualAmount: "actual_amount" } as const;
export const AMOUNT_KEYS = ["requestedAmount", "approvedAmount", "actualAmount"] as const;

export function budgetTotals(rows: Pick<BudgetPosition, typeof AMOUNT_KEYS[number]>[]) {
  const totals = { requestedAmount: null, approvedAmount: null, actualAmount: null } as Record<typeof AMOUNT_KEYS[number], number | null>;
  for (const key of AMOUNT_KEYS) {
    for (const row of rows) if (row[key] != null) {
      const value = row[key];
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_CENTS) throw new Error("Ungültiger Positionsbetrag.");
      totals[key] = (totals[key] ?? 0) + value;
      if (totals[key]! > MAX_AMOUNT_CENTS) throw new Error("Die Gesamtsumme darf 20.000.000,00 € nicht überschreiten.");
    }
  }
  return totals;
}
export function budgetTitles(rows: { budgetTitle: string | null }[]): string | null {
  return [...new Set(rows.map((r) => r.budgetTitle?.trim()).filter(Boolean))].join(", ") || null;
}
export function canReturnToSingle(rows: BudgetPosition[]) { return rows.length === 1 && !rows[0].description; }
