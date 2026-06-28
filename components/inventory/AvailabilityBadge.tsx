// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import type { InventoryAvailability } from "@/lib/inventory-items";

function fmtDate(s: string | null): string {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : s;
}

/**
 * Automatischer Verfügbarkeits-Status eines Gegenstands — nicht entleihbar /
 * verfügbar / entliehen (bis Datum). Wird intern und öffentlich verwendet.
 */
export function AvailabilityBadge({
  availability,
  until,
}: {
  availability: InventoryAvailability;
  until: string | null;
}) {
  if (availability === "not_lendable") {
    return (
      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        nicht entleihbar
      </span>
    );
  }
  if (availability === "lent") {
    return (
      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        entliehen{until ? ` bis ${fmtDate(until)}` : ""}
      </span>
    );
  }
  return (
    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      verfügbar
    </span>
  );
}
