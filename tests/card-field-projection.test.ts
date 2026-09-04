import { test } from "node:test";
import assert from "node:assert/strict";
import { maskHiddenCardFields } from "../lib/card-field-projection";

test("client props and searchable fields do not carry disabled card values", () => {
  const card = { id: 1, title: "Visible title", applicant: "Hidden applicant", number: "Hidden number",
    requestedAmount: 12345, accountName: "Hidden account", budgetTitle: "Hidden allocation",
    notes: "Hidden notes", assignees: [{ id: 2 }], assigneeUserIds: [2], creator: { id: 3 } };
  const projected = maskHiddenCardFields(card, new Set(["number"]));
  assert.deepEqual(projected, { id: 1, title: "Visible title", number: "Hidden number",
    applicant: "", requestedAmount: null, accountName: null, budgetTitle: null,
    notes: null, assignees: [], assigneeUserIds: [], creator: null });
  assert.equal(card.requestedAmount, 12345, "projection never clears stored values");
});
