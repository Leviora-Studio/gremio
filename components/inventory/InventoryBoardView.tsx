// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InventoryItemView } from "@/lib/inventory-items";
import { Select } from "@/components/Select";
import { AvailabilityBadge } from "./AvailabilityBadge";
import {
  ItemFormModal,
  type GroupedOpts,
  type Opt,
} from "./ItemFormModal";

type OptionKind = keyof GroupedOpts;

const COLUMNS: { key: string; label: string; always?: boolean }[] = [
  { key: "name", label: "Bezeichnung", always: true },
  { key: "group", label: "Obergruppe" },
  { key: "number", label: "Inv.-Nr." },
  { key: "serial_number", label: "Seriennr." },
  { key: "category", label: "Kategorie" },
  { key: "location", label: "Standort" },
  { key: "current_holder", label: "Aktuell bei" },
  { key: "availability", label: "Verfügbarkeit" },
  { key: "price", label: "Einzelpreis" },
  { key: "purchase_date", label: "Kaufdatum" },
  { key: "vendor", label: "Händler" },
];

function formatPrice(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return d ? `${d}.${m}.${y}` : s;
}

export function InventoryBoardView({
  boardId,
  visibleFields,
  numberingEnabled,
  initialOptions,
  groupNames,
  items,
}: {
  boardId: number;
  visibleFields: string[];
  numberingEnabled: boolean;
  initialOptions: GroupedOpts;
  groupNames: string[];
  items: InventoryItemView[];
}) {
  const router = useRouter();
  const [options, setOptions] = useState<GroupedOpts>(initialOptions);
  const [createOpen, setCreateOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [fCategory, setFCategory] = useState<number | null>(null);
  const [fLocation, setFLocation] = useState<number | null>(null);
  const [fAvail, setFAvail] = useState<string>("");
  const [grouped, setGrouped] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const cols = COLUMNS.filter(
    (c) => c.always || visibleFields.includes(c.key),
  );

  // Gruppierung nur anbieten, wenn das Feld aktiv ist und Gruppen vorkommen.
  const hasGroups =
    visibleFields.includes("group") &&
    items.some((it) => (it.groupName ?? "").trim() !== "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hay = `${it.name} ${it.groupName ?? ""} ${it.number ?? ""} ${it.serialNumber ?? ""} ${it.vendor ?? ""} ${it.categoryNames.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (fCategory != null && !it.categoryIds.includes(fCategory)) return false;
      if (fLocation != null && it.locationId !== fLocation) return false;
      if (fAvail && it.availability !== fAvail) return false;
      return true;
    });
  }, [items, query, fCategory, fLocation, fAvail]);

  // Nach „Obergruppe" bündeln: gleiche groupName → ein Sammel-Posten,
  // Gegenstände ohne Obergruppe bleiben einzeln.
  const groups = useMemo(() => {
    const map = new Map<string, InventoryItemView[]>();
    const singles: InventoryItemView[] = [];
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
    // (z. B. 3 + 4 = 7). Verfügbar analog die Summe der freien Mengen
    // (availableQuantity ist bei nicht entleihbaren/defekten Stücken 0).
    const grouped = [...map.entries()].map(([name, its]) => ({
      key: `g:${name}`,
      name,
      items: its,
      total: its.reduce((s, i) => s + i.quantity, 0),
      available: its.reduce((s, i) => s + i.availableQuantity, 0),
    }));
    const single = singles.map((it) => ({
      key: `i:${it.id}`,
      name: null as string | null,
      items: [it],
      total: it.quantity,
      available: it.availableQuantity,
    }));
    return [...grouped, ...single].sort((a, b) =>
      (a.name ?? a.items[0].name).localeCompare(b.name ?? b.items[0].name),
    );
  }, [filtered]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onSaved() {
    setCreateOpen(false);
    router.refresh();
  }
  function onOptionAdded(kind: OptionKind, opt: Opt) {
    setOptions((prev) => ({
      ...prev,
      [kind]: [...prev[kind], opt].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  const showCat = visibleFields.includes("category") && options.category.length > 0;
  const showLoc = visibleFields.includes("location") && options.location.length > 0;
  const showAvail = visibleFields.includes("availability");

  return (
    <div className="space-y-4">
      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suche (Bezeichnung, Nummer, Händler) …"
          className="input max-w-xs flex-1"
        />
        {showCat && (
          <FilterSelect
            label="Kategorie"
            options={options.category}
            value={fCategory}
            onChange={setFCategory}
          />
        )}
        {showLoc && (
          <FilterSelect
            label="Standort"
            options={options.location}
            value={fLocation}
            onChange={setFLocation}
          />
        )}
        {showAvail && (
          <Select
            className="w-auto"
            placeholder="Verfügbarkeit: alle"
            value={fAvail}
            onChange={setFAvail}
            options={[
              { value: "", label: "Verfügbarkeit: alle" },
              { value: "available", label: "verfügbar" },
              { value: "lent", label: "entliehen" },
              { value: "not_lendable", label: "nicht entleihbar" },
            ]}
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasGroups && (
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              <button
                type="button"
                onClick={() => setGrouped(true)}
                className={`px-3 py-1.5 text-sm ${
                  grouped
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Nach Obergruppe
              </button>
              <button
                type="button"
                onClick={() => setGrouped(false)}
                className={`border-l border-slate-300 px-3 py-1.5 text-sm ${
                  grouped
                    ? "bg-white text-slate-600 hover:bg-slate-50"
                    : "bg-brand-50 font-medium text-brand-700"
                }`}
              >
                Liste
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-primary"
          >
            + Neuer Gegenstand
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Noch keine Gegenstände. Lege den ersten über „+ Neuer Gegenstand" an.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped
                ? groups.map((g) => {
                    const single = g.name === null;
                    if (single) {
                      const it = g.items[0];
                      return (
                        <tr
                          key={g.key}
                          onClick={() =>
                            router.push(`/intern/inventar/item/${it.id}`)
                          }
                          className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                        >
                          {cols.map((c) => (
                            <td key={c.key} className="px-3 py-2 align-top">
                              {renderCell(c.key, it)}
                            </td>
                          ))}
                        </tr>
                      );
                    }
                    const isOpen = expanded.has(g.key);
                    return (
                      <Fragment key={g.key}>
                        <tr
                          onClick={() => toggleExpand(g.key)}
                          className="cursor-pointer border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100"
                        >
                          <td
                            colSpan={cols.length}
                            className="px-3 py-2 align-top"
                          >
                            <span className="flex items-center gap-2 font-medium text-slate-800">
                              <span
                                className={`inline-block text-slate-400 transition-transform ${
                                  isOpen ? "rotate-90" : ""
                                }`}
                              >
                                ▸
                              </span>
                              {g.name}
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                                {g.total} Stück
                              </span>
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                                {g.available} verfügbar
                              </span>
                            </span>
                          </td>
                        </tr>
                        {isOpen &&
                          g.items.map((it) => (
                            <tr
                              key={it.id}
                              onClick={() =>
                                router.push(`/intern/inventar/item/${it.id}`)
                              }
                              className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                            >
                              {cols.map((c, i) => (
                                <td
                                  key={c.key}
                                  className={`px-3 py-2 align-top ${
                                    i === 0 ? "pl-8" : ""
                                  }`}
                                >
                                  {renderCell(c.key, it)}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })
                : filtered.map((it) => (
                    <tr
                      key={it.id}
                      onClick={() =>
                        router.push(`/intern/inventar/item/${it.id}`)
                      }
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      {cols.map((c) => (
                        <td key={c.key} className="px-3 py-2 align-top">
                          {renderCell(c.key, it)}
                        </td>
                      ))}
                    </tr>
                  ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={cols.length}
                    className="px-3 py-6 text-center text-slate-400"
                  >
                    Keine Treffer für die aktuelle Filterung.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <ItemFormModal
          boardId={boardId}
          item={null}
          visibleFields={visibleFields}
          options={options}
          groupNames={groupNames}
          numberingEnabled={numberingEnabled}
          onClose={() => setCreateOpen(false)}
          onSaved={onSaved}
          onOptionAdded={onOptionAdded}
        />
      )}
    </div>
  );
}

function renderCell(key: string, it: InventoryItemView) {
  switch (key) {
    case "name":
      return (
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
          {it.name || "—"}
          {it.quantity > 1 && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {it.quantity} Stück
            </span>
          )}
          {it.openDefects > 0 && (
            <span
              title={`${it.openDefects} offene(r) Mangel/Mängel`}
              className="rounded bg-amber-100 px-1 py-0.5 text-xs font-medium text-amber-700"
            >
              ⚠ {it.openDefects}
            </span>
          )}
        </span>
      );
    case "current_holder":
      return it.activeBorrower ?? "—";
    case "availability":
      if (it.quantity > 1)
        return (
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
              it.availableQuantity > 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {it.availableQuantity} von {it.quantity} verfügbar
          </span>
        );
      return (
        <AvailabilityBadge availability={it.availability} until={it.activeUntil} />
      );
    case "group":
      return it.groupName ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
          {it.groupName}
        </span>
      ) : (
        "—"
      );
    case "number":
      return it.number ?? "—";
    case "serial_number":
      return it.serialNumber ?? "—";
    case "category":
      return it.categoryNames.length ? (
        <span className="flex flex-wrap gap-1">
          {it.categoryNames.map((n) => (
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
    case "location":
      return it.locationName ?? "—";
    case "price":
      return formatPrice(it.price);
    case "purchase_date":
      return formatDate(it.purchaseDate);
    case "vendor":
      return it.vendor ?? "—";
    default:
      return "—";
  }
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Opt[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Select
      className="w-auto"
      placeholder={`${label}: alle`}
      searchable={options.length > 8}
      value={value == null ? "" : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
      options={[
        { value: "", label: `${label}: alle` },
        ...options.map((o) => ({ value: String(o.id), label: o.name })),
      ]}
    />
  );
}
