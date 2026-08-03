// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  PublicInventoryItem,
  PublicOpt,
} from "@/lib/inventory-public";
import { AvailabilityBadge } from "./AvailabilityBadge";

type Options = {
  category: PublicOpt[];
};

// Eine Tabellenzeile: Einzelstück, Sammel-Posten (Gruppe) oder Mengen-Gegenstand
// (eine Nummer, mehrere Einheiten).
type Row = {
  key: string;
  name: string;
  categoryNames: string[];
  kind: "single" | "group" | "bulk";
  groupName: string | null;
  total: number; // Stückzahl gesamt (bei Gruppe/Menge > 1)
  available: number; // aktuell verfügbare Stückzahl
  item: PublicInventoryItem; // Repräsentant (für Einzel-/Mengen-Anfrage)
};

export function PublicInventoryBoard({
  boardId,
  publicFields,
  items,
  options,
}: {
  boardId: number;
  publicFields: string[];
  items: PublicInventoryItem[];
  options: Options;
}) {
  const [query, setQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState<number[]>([]);

  const showCategory =
    publicFields.includes("category") && options.category.length > 0;

  // Kategorie-Facetten mit Trefferzahl.
  const catCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of items)
      for (const id of it.categoryIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [items]);

  const toggleCat = (id: number) =>
    setSelectedCats((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q && !`${it.name} ${it.categoryNames.join(" ")}`.toLowerCase().includes(q))
        return false;
      // Facetten: Treffer, wenn mind. eine gewählte Kategorie zutrifft (ODER).
      if (
        selectedCats.length &&
        !it.categoryIds.some((c) => selectedCats.includes(c))
      )
        return false;
      return true;
    });
  }, [items, query, selectedCats]);

  // Gleiche Obergruppe zu einem Sammel-Posten bündeln (Stückzahl); Stücke
  // ohne Obergruppe bleiben einzeln.
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, PublicInventoryItem[]>();
    const singles: PublicInventoryItem[] = [];
    for (const it of filtered) {
      const g = (it.groupName ?? "").trim();
      if (!g) {
        singles.push(it);
        continue;
      }
      const arr = map.get(g) ?? [];
      arr.push(it);
      map.set(g, arr);
    }
    // Stückzahl der Obergruppe = Summe der Einzel-Stückzahlen, NICHT die Anzahl
    // der Datensätze: ein Mitglied mit quantity > 1 zählt entsprechend mehrfach
    // (z. B. 3 + 4 = 7). Verfügbar analog die Summe der freien Mengen.
    const groupRows: Row[] = [...map.entries()].map(([name, its]) => ({
      key: `g:${name}`,
      name,
      categoryNames: its[0].categoryNames,
      kind: "group",
      groupName: name,
      total: its.reduce((s, i) => s + i.quantity, 0),
      available: its.reduce((s, i) => s + i.availableQuantity, 0),
      item: its[0],
    }));
    // Einzel- und Mengen-Gegenstände nutzen dieselbe Mengenquelle wie Gruppen,
    // damit die drei Fälle nicht auseinanderlaufen (bei quantity = 1 ist
    // availableQuantity genau 0 oder 1).
    const singleRows: Row[] = singles.map((it) => ({
      key: `i:${it.id}`,
      name: it.name,
      categoryNames: it.categoryNames,
      kind: it.quantity > 1 ? "bulk" : "single",
      groupName: null,
      total: it.quantity,
      available: it.availableQuantity,
      item: it,
    }));
    return [...groupRows, ...singleRows].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [filtered]);

  return (
    <div className="flex flex-col gap-5 md:flex-row">
      {showCategory && (
        <aside className="md:w-52 md:shrink-0">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Kategorien
              </h2>
              {selectedCats.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedCats([])}
                  className="text-xs text-brand-600 hover:underline"
                >
                  zurücksetzen
                </button>
              )}
            </div>
            <ul className="space-y-0.5">
              {options.category
                .filter((o) => (catCounts.get(o.id) ?? 0) > 0)
                .map((o) => {
                  const active = selectedCats.includes(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => toggleCat(o.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${
                          active
                            ? "bg-brand-50 font-medium text-brand-700"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                              active
                                ? "border-brand-500 bg-brand-500 text-white"
                                : "border-slate-300"
                            }`}
                          >
                            {active ? "✓" : ""}
                          </span>
                          {o.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {catCounts.get(o.id) ?? 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        </aside>
      )}

      <div className="min-w-0 flex-1 space-y-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suche (Bezeichnung) …"
          className="input w-full sm:max-w-xs"
        />

        {items.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">
            Aktuell sind keine Gegenstände vorhanden.
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Bezeichnung</th>
                  {showCategory && (
                    <th className="px-3 py-2 font-medium">Kategorie</th>
                  )}
                  <th className="px-3 py-2 font-medium">Verfügbarkeit</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-2 align-top">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800">
                        {r.name || "—"}
                        {r.kind !== "single" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                            {r.total} Stück
                          </span>
                        )}
                      </span>
                    </td>
                    {showCategory && (
                      <td className="px-3 py-2 align-top">
                        {renderCategories(r.categoryNames)}
                      </td>
                    )}
                    <td className="px-3 py-2 align-top">
                      {r.kind !== "single" ? (
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                            r.available > 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {r.available} von {r.total} verfügbar
                        </span>
                      ) : (
                        <AvailabilityBadge
                          availability={r.item.availability}
                          until={r.item.lentUntil}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {r.available === 0 ? (
                        <span className="btn-secondary cursor-not-allowed px-2.5 py-1 text-xs opacity-40">
                          Anfragen
                        </span>
                      ) : (
                        <Link
                          href={
                            r.kind === "group"
                              ? `/inventar/${boardId}/anfrage?group=${encodeURIComponent(r.groupName as string)}`
                              : `/inventar/${boardId}/anfrage?item=${r.item.id}`
                          }
                          className="btn-secondary inline-block px-2.5 py-1 text-xs"
                        >
                          Anfragen
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={showCategory ? 4 : 3}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      Keine Treffer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function renderCategories(names: string[]) {
  return names.length ? (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
        >
          {n}
        </span>
      ))}
    </span>
  ) : (
    "—"
  );
}
