// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { InventoryItemView } from "@/lib/inventory-items";
import { AvailabilityBadge } from "./AvailabilityBadge";
import {
  ItemFormModal,
  type GroupedOpts,
  type Opt,
} from "./ItemFormModal";

type OptionKind = keyof GroupedOpts;

const COLUMNS: { key: string; label: string; always?: boolean }[] = [
  { key: "name", label: "Bezeichnung", always: true },
  { key: "number", label: "Inv.-Nr." },
  { key: "category", label: "Kategorie" },
  { key: "location", label: "Standort" },
  { key: "current_holder", label: "Aktuell bei" },
  { key: "availability", label: "Verfügbarkeit" },
  { key: "price", label: "Preis" },
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
  items,
}: {
  boardId: number;
  visibleFields: string[];
  numberingEnabled: boolean;
  initialOptions: GroupedOpts;
  items: InventoryItemView[];
}) {
  const router = useRouter();
  const [options, setOptions] = useState<GroupedOpts>(initialOptions);
  const [createOpen, setCreateOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [fCategory, setFCategory] = useState<number | null>(null);
  const [fLocation, setFLocation] = useState<number | null>(null);
  const [fAvail, setFAvail] = useState<string>("");

  const cols = COLUMNS.filter(
    (c) => c.always || visibleFields.includes(c.key),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hay = `${it.name} ${it.number ?? ""} ${it.vendor ?? ""} ${it.categoryNames.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (fCategory != null && !it.categoryIds.includes(fCategory)) return false;
      if (fLocation != null && it.locationId !== fLocation) return false;
      if (fAvail && it.availability !== fAvail) return false;
      return true;
    });
  }, [items, query, fCategory, fLocation, fAvail]);

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
          className="input h-9 max-w-xs flex-1 py-1.5"
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
          <select
            className="input h-9 w-auto py-1.5 text-sm"
            value={fAvail}
            onChange={(e) => setFAvail(e.target.value)}
            aria-label="Verfügbarkeit"
          >
            <option value="">Verfügbarkeit: alle</option>
            <option value="available">verfügbar</option>
            <option value="lent">entliehen</option>
            <option value="not_lendable">nicht entleihbar</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="btn-primary ml-auto h-9 py-1.5"
        >
          + Neuer Gegenstand
        </button>
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
              {filtered.map((it) => (
                <tr
                  key={it.id}
                  onClick={() => router.push(`/intern/inventar/item/${it.id}`)}
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
      return (
        <AvailabilityBadge availability={it.availability} until={it.activeUntil} />
      );
    case "number":
      return it.number ?? "—";
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
    <select
      className="input h-9 w-auto py-1.5 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label={label}
    >
      <option value="">{label}: alle</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
