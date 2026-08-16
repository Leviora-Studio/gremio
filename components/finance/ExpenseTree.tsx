// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { formatCents } from "@/lib/money";

type Leaf = {
  id: number;
  haushaltstitel: string;
  title: string;
  planned: number | null;
  spent: number;
};
export type ExpenseRow = Leaf & { children: Leaf[] };

function amount(v: number | null) {
  return v != null ? formatCents(v) : "—";
}

/** Rest grün (noch Budget übrig), rot (überzogen), neutral (0/unbekannt). */
function restClass(rest: number | null): string {
  if (rest == null || rest === 0) return "";
  return rest > 0 ? "text-green-600" : "text-red-600";
}

/** Drei rechtsbündige Betragsspalten (Geplant / Ausgegeben / Rest). */
function Amounts({
  planned,
  spent,
}: {
  planned: number | null;
  spent: number;
}) {
  const rest = planned != null ? planned - spent : null;
  return (
    <>
      <span className="w-28 shrink-0 whitespace-nowrap text-right">
        {amount(planned)}
      </span>
      <span className="w-28 shrink-0 whitespace-nowrap text-right">
        {formatCents(spent)}
      </span>
      <span
        className={`w-28 shrink-0 whitespace-nowrap text-right font-medium ${restClass(rest)}`}
      >
        {amount(rest)}
      </span>
    </>
  );
}

export function ExpenseTree({
  rows,
  unmatched,
  spentTotal: matchedTotal,
}: {
  rows: ExpenseRow[];
  unmatched: { title: string; spent: number }[];
  spentTotal: number;
}) {
  const plannedTotal = rows.reduce((s, r) => s + (r.planned ?? 0), 0);
  // matchedTotal ist bereits dedupliziert (jeder Haushaltstitel einmal) — NICHT
  // erneut die Zeilen aufsummieren, sonst doppelte Zählung bei gleichem Titel.
  const spentTotal = matchedTotal + unmatched.reduce((s, u) => s + u.spent, 0);

  if (rows.length === 0 && unmatched.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Noch kein Haushaltsplan angelegt (in den Einstellungen).
      </p>
    );
  }

  return (
    // Mobil: drei feste Betragsspalten (3×w-28) passen nicht neben den Titel →
    // horizontal scrollbar mit Mindestbreite. Auf Desktop ohne Wirkung.
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-[34rem] space-y-3">
      {/* Spaltenkopf */}
      <div className="flex items-center gap-2 border border-transparent px-3 text-xs uppercase text-slate-400">
        <span className="flex-1">Haushaltstitel / Bezeichnung</span>
        <span className="w-28 shrink-0 text-right">Geplant</span>
        <span className="w-28 shrink-0 text-right">Ausgegeben</span>
        <span className="w-28 shrink-0 text-right">Rest</span>
      </div>

      {/* Eine Box je Oberpunkt */}
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center gap-2 font-medium">
            <span className="flex-1">
              {r.haushaltstitel && (
                <span className="text-slate-500">{r.haushaltstitel} </span>
              )}
              {r.title || "(ohne Bezeichnung)"}
            </span>
            <Amounts planned={r.planned} spent={r.spent} />
          </div>
          {r.children.map((c) => (
            <div
              key={c.id}
              className="ml-4 flex items-center gap-2 border-t border-slate-100 py-1 text-sm text-slate-600"
            >
              <span className="flex-1">
                {c.haushaltstitel && (
                  <span className="text-slate-500">{c.haushaltstitel} </span>
                )}
                {c.title || "(ohne Bezeichnung)"}
              </span>
              <Amounts planned={c.planned} spent={c.spent} />
            </div>
          ))}
        </div>
      ))}

      {/* Ausgaben ohne Plan-Zuordnung — eigene Box */}
      {unmatched.length > 0 && (
        <div className="rounded-md border border-slate-200 p-3">
          <div className="mb-1 text-xs uppercase text-slate-400">
            Ohne Plan-Zuordnung
          </div>
          {unmatched.map((u) => (
            <div
              key={u.title}
              className="flex items-center gap-2 border-t border-slate-100 py-1 text-sm text-slate-600 first:border-t-0"
            >
              <span className="flex-1">{u.title}</span>
              <Amounts planned={null} spent={u.spent} />
            </div>
          ))}
        </div>
      )}

      {/* Summe */}
      <div className="flex items-center gap-2 border border-transparent px-3 pt-1 font-semibold">
        <span className="flex-1">Summe</span>
        <span className="w-28 shrink-0 whitespace-nowrap text-right">
          {formatCents(plannedTotal)}
        </span>
        <span className="w-28 shrink-0 whitespace-nowrap text-right">
          {formatCents(spentTotal)}
        </span>
        <span
          className={`w-28 shrink-0 whitespace-nowrap text-right ${restClass(
            plannedTotal - spentTotal,
          )}`}
        >
          {formatCents(plannedTotal - spentTotal)}
        </span>
      </div>
      </div>
    </div>
  );
}
