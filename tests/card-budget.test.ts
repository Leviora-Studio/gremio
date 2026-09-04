import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetTotals, budgetTitles, budgetPositionsSchema, canReturnToSingle, editableBudgetPosition } from "../lib/card-budget";
import { randomUUID } from "node:crypto";

const row = (requestedAmount: number | null, approvedAmount: number | null, actualAmount: number | null) => ({ id: randomUUID(), budgetTitle: "12345", description: null, accountId: 1, requestedAmount, approvedAmount, actualAmount });
test("database metadata never enters editable position payloads", () => {
  const stored = { ...row(20000, 15000, 13000), cardId: 42, position: 1 };
  assert.equal(budgetPositionsSchema.safeParse([stored]).success, false, "write validation remains strict");
  const edited = { ...editableBudgetPosition(stored), description: "Changed after reload" };
  assert.equal(budgetPositionsSchema.safeParse([edited]).success, true);
  assert.equal("cardId" in edited, false);
  assert.equal("position" in edited, false);
  assert.equal(edited.id, stored.id);
});
test("budget cents: independent sums, blank vs zero, example and integer limits", () => {
  assert.deepEqual(budgetTotals([row(20000, 15000, 13000), row(20000, 20000, 18000)]), { requestedAmount: 40000, approvedAmount: 35000, actualAmount: 31000 });
  assert.deepEqual(budgetTotals([row(null, 0, null), row(null, null, 10)]), { requestedAmount: null, approvedAmount: 0, actualAmount: 10 });
  assert.deepEqual(budgetTotals([row(null, null, null)]), { requestedAmount: null, approvedAmount: null, actualAmount: null });
  assert.throws(() => budgetTotals([row(2000000000, null, null), row(1, null, null)]));
  for (const n of [-1, 0.5, NaN, Infinity, 2147483648]) assert.throws(() => budgetTotals([row(n, null, null)]));
});
test("stable IDs, required accounts, duplicate titles and lossless single-mode conversion", () => {
  const a = row(0, null, null);
  assert.equal(budgetPositionsSchema.safeParse([{ ...a, accountId: null }]).success, false);
  assert.equal(budgetPositionsSchema.safeParse([a, a]).success, false);
  assert.equal(budgetPositionsSchema.safeParse([a, { ...a, id: randomUUID(), description: "Other" }]).success, true);
  assert.equal(budgetTitles([a, a, { budgetTitle: "12344" }]), "12345, 12344");
  assert.equal(canReturnToSingle([a]), true);
  assert.equal(canReturnToSingle([{ ...a, description: "Must survive" }]), false);
});
