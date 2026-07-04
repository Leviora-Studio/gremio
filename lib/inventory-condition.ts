// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Zustand eines einzelnen Inventar-Stücks (rein intern). defect/lost = Archiv.

export const INVENTORY_CONDITIONS = ["active", "defect", "lost"] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];

export const ARCHIVED_CONDITIONS: InventoryCondition[] = ["defect", "lost"];

export const CONDITION_LABEL: Record<string, string> = {
  active: "Aktiv",
  defect: "Defekt",
  lost: "Verloren gegangen",
};

export function conditionLabel(c: string): string {
  return CONDITION_LABEL[c] ?? c;
}

export function conditionClass(c: string): string {
  switch (c) {
    case "defect":
      return "bg-amber-100 text-amber-700";
    case "lost":
      return "bg-red-100 text-red-700";
    default:
      return "bg-emerald-50 text-emerald-700";
  }
}
