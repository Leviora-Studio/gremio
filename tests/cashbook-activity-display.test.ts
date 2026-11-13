// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { cashbookActivityChanges, formatCashbookActivityValue as display } from "../lib/cashbook/activity-display";

test("historical authorization patches show only the changed state, never removed unchanged values", () => {
    const result = cashbookActivityChanges({
        before: { state: "submitted", bookingDate: null, officeDone: false, secondSignerId: 42 },
        after: { state: "posted", authorizedAt: "2026-11-14T00:00:00Z", revision: 8 },
    });
    assert.deepEqual(result.rows.map(row => row.key), ["state"]);
    assert.equal(result.comparison, true);
    assert.equal(display("state", result.rows[0].before, {}), "Zur Unterschrift vorgelegt");
    assert.equal(display("state", result.rows[0].after, {}), "Anweisung erteilt");
});

test("empty representations are equivalent, while actual clearing remains visible", () => {
    assert.equal(cashbookActivityChanges({ before: { purpose: null, receiptIds: [] }, after: { purpose: "", receiptIds: [] } }).rows.length, 0);
    const cleared = cashbookActivityChanges({ before: { purpose: "Materials" }, after: { purpose: null } });
    assert.equal(cleared.rows.length, 1);
    assert.equal(display("purpose", cleared.rows[0].after, {}), "Nicht angegeben");
    assert.equal(cashbookActivityChanges({ before: { officeDone: false }, after: { officeDone: false } }).rows.length, 0);
});

test("newly recorded values do not imply a known empty previous value", () => {
    const result = cashbookActivityChanges({ after: { place: "Köthen", date: "2026-11-14" } });
    assert.equal(result.comparison, false);
    assert.ok(result.rows.every(row => !row.hasBefore));
    const created = cashbookActivityChanges({ data: { amount: 0, purpose: "", business: false, receiptIds: [] } });
    assert.deepEqual(created.rows.map(row => row.key), ["amount", "business"]);
    assert.equal(created.comparison, false);
});

test("office processing, dates, assignments and literal text have unambiguous labels", () => {
    assert.equal(display("officeDone", false, {}), "Noch zu erledigen");
    assert.equal(display("officeDone", true, {}), "Erledigt");
    assert.equal(display("bookingDate", null, {}), "Noch nicht eingetragen");
    assert.equal(display("secondSignerId", null, {}), "Noch nicht zugewiesen");
    assert.equal(display("secondSignerId", 42, { "42": "Finanzer" }), "Finanzer");
    assert.equal(display("date", "2026-11-14", {}), "14.11.2026");
    assert.equal(display("purpose", "posted", {}), "posted");
});
