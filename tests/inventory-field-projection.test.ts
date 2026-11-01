// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskHiddenInventoryFields } from "../lib/inventory-field-projection";

test("inventory client props mask disabled metadata and preserve stock controls and stored values", () => {
  const item = { id: 1, name: "Visible item", groupName: "Private group", number: "Private number", serialNumber: "Private serial",
    categoryIds: [2], categoryNames: ["Private category"], locationId: 3, locationName: "Private location", condition: "defect", conditionNote: "Private condition",
    activeBorrower: "Private borrower", activeUntil: "2026-12-01", price: 1500, purchaseDate: "2025-01-01", vendor: "Private vendor", notes: "Private notes",
    quantity: 3, lendable: false, availableQuantity: 0 };
  assert.deepEqual(maskHiddenInventoryFields(item, new Set()), { id: 1, name: "Visible item", groupName: null, number: null, serialNumber: null,
    categoryIds: [], categoryNames: [], locationId: null, locationName: null, condition: "defect", conditionNote: null,
    activeBorrower: null, activeUntil: null, price: null, purchaseDate: null, vendor: null, notes: null,
    quantity: 3, lendable: false, availableQuantity: 0 });
  assert.equal(item.notes, "Private notes");
  assert.equal(maskHiddenInventoryFields(item, new Set(["notes"])).notes, item.notes);
  assert.deepEqual(maskHiddenInventoryFields(item, new Set(["category"])).categoryIds, [2]);
});
