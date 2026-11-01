// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/** Mask optional item metadata before sending client props or search data.
 * Stock/condition/availability remain operational inputs to the loan controls.
 */
export function maskHiddenInventoryFields<T extends object>(item: T, visible: ReadonlySet<string>): T {
  const result = { ...item } as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    group: ["groupName"], number: ["number"], serial_number: ["serialNumber"],
    category: ["categoryIds", "categoryNames"], location: ["locationId", "locationName"],
    condition: ["conditionNote"], current_holder: ["activeBorrower", "activeUntil"],
    price: ["price"], purchase_date: ["purchaseDate"], vendor: ["vendor"], notes: ["notes"],
  };
  for (const [field, keys] of Object.entries(fields)) {
    if (visible.has(field)) continue;
    for (const key of keys) if (key in result) result[key] = key === "categoryIds" || key === "categoryNames" ? [] : null;
  }
  return result as T;
}
