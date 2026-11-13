// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBudgetPlan, budgetPlanMotionValues } from "../lib/card-budget-plan";
import { renderFinanceMotion, validFinanceMotion } from "../lib/meetings/finance-motion";

test("motion planning preserves each ordered amount/title pair and formats a complete decision", () => {
  const rows = parseBudgetPlan([
    { amount: "1.234,56", budgetTitle: "1200" },
    { amount: "250.50", budgetTitle: "1300" },
    { amount: "0", budgetTitle: "1200" },
  ]);
  assert.deepEqual(rows.map(r => r.amount), [123456, 25050, 0]);
  assert.deepEqual(budgetPlanMotionValues(rows), {
    planned_budget: "1.234,56 € aus Titel 1200, 250,50 € aus Titel 1300 und 0,00 € aus Titel 1200",
    planned_budget_total: "1.485,06 €", planned_budget_titles: "1200, 1300, 1200",
  });
  const template = "Es werden {{planned_budget}} eingeplant (insgesamt {{planned_budget_total}}).";
  assert.equal(validFinanceMotion(template, new Set(["planned_budget"])), true);
  assert.equal(validFinanceMotion(template, new Set(["budget_title", "requested_amount"])), false);
  assert.equal(renderFinanceMotion(template, budgetPlanMotionValues(rows)), "Es werden 1.234,56 € aus Titel 1200, 250,50 € aus Titel 1300 und 0,00 € aus Titel 1200 eingeplant (insgesamt 1.485,06 €).");
  assert.equal(renderFinanceMotion("{{planned_budget}}", {}), "Nicht freigegeben");
  assert.equal(budgetPlanMotionValues(rows.slice(0, 1)).planned_budget, "1.234,56 € aus Titel 1200");
  assert.equal(budgetPlanMotionValues(rows.slice(0, 2)).planned_budget, "1.234,56 € aus Titel 1200 und 250,50 € aus Titel 1300");
  assert.equal(budgetPlanMotionValues([]).planned_budget, "—");
});

test("invalid or incomplete planning is rejected atomically, while zero and clearing are supported", () => {
  for (const input of [null, {}, [null], [{ amount: 100, budgetTitle: "A" }], [{ amount: "", budgetTitle: "A" }], [{ amount: "-1", budgetTitle: "A" }], [{ amount: "1.2.3", budgetTitle: "A" }], [{ amount: "20000000,01", budgetTitle: "A" }], [{ amount: "1", budgetTitle: " \n " }], [{ amount: "1", budgetTitle: "x".repeat(201) }], Array.from({ length: 101 }, () => ({ amount: "1", budgetTitle: "A" }))]) {
    assert.throws(() => parseBudgetPlan(input));
  }
  assert.deepEqual(parseBudgetPlan([]), []);
  assert.deepEqual(parseBudgetPlan([{ amount: "0", budgetTitle: " A\nB\0 " }]), [{ amount: 0, budgetTitle: "A B" }]);
});
