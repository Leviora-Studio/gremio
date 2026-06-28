// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useMemo, useState } from "react";
import type {
  PublicInventoryItem,
  PublicOpt,
} from "@/lib/inventory-public";
import { AvailabilityBadge } from "./AvailabilityBadge";
import {
  createInventoryLoanRequestAction,
  type RequestState,
} from "@/app/inventar/request-actions";

const COLUMNS: { key: string; label: string; always?: boolean }[] = [
  { key: "name", label: "Bezeichnung", always: true },
  { key: "number", label: "Inv.-Nr." },
  { key: "category", label: "Kategorie" },
  { key: "location", label: "Standort" },
];

type Options = {
  category: PublicOpt[];
  location: PublicOpt[];
};

export function PublicInventoryBoard({
  publicFields,
  items,
  options,
}: {
  publicFields: string[];
  items: PublicInventoryItem[];
  options: Options;
}) {
  const [query, setQuery] = useState("");
  const [fCategory, setFCategory] = useState<number | null>(null);
  const [fLocation, setFLocation] = useState<number | null>(null);
  const [requestItem, setRequestItem] = useState<PublicInventoryItem | null>(
    null,
  );

  const cols = COLUMNS.filter(
    (c) => c.always || publicFields.includes(c.key),
  );
  const showCat = publicFields.includes("category") && options.category.length > 0;
  const showLoc = publicFields.includes("location") && options.location.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const hay = `${it.name} ${it.number ?? ""} ${it.categoryNames.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (fCategory != null && !it.categoryIds.includes(fCategory)) return false;
      if (fLocation != null && it.locationId !== fLocation) return false;
      return true;
    });
  }, [items, query, fCategory, fLocation]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suche (Bezeichnung, Nummer) …"
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
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Aktuell sind keine Gegenstände vorhanden.
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
                <th className="px-3 py-2 font-medium">Verfügbarkeit</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr
                  key={it.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-2 align-top">
                      {renderCell(c.key, it)}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    <AvailabilityBadge
                      availability={it.availability}
                      until={it.lentUntil}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <button
                      type="button"
                      onClick={() => setRequestItem(it)}
                      className="btn-secondary px-2.5 py-1 text-xs"
                    >
                      Anfragen
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={cols.length + 2}
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

      {requestItem && (
        <RequestModal
          item={requestItem}
          onClose={() => setRequestItem(null)}
        />
      )}
    </div>
  );
}

function renderCell(key: string, it: PublicInventoryItem) {
  switch (key) {
    case "name":
      return <span className="font-medium text-slate-800">{it.name || "—"}</span>;
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
  options: PublicOpt[];
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

function RequestModal({
  item,
  onClose,
}: {
  item: PublicInventoryItem;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    createInventoryLoanRequestAction,
    {} as RequestState,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card w-full max-w-md space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Gegenstand anfragen</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-slate-600">
          <strong>{item.name}</strong>
          {item.number ? ` (${item.number})` : ""}
        </p>

        <form action={action} noValidate className="space-y-3">
          <input type="hidden" name="itemId" value={item.id} />
          <div>
            <label htmlFor="rq-borrower" className="label">
              Dein Name
            </label>
            <input
              id="rq-borrower"
              name="borrower"
              className="input"
              defaultValue={state.values?.borrower ?? ""}
            />
          </div>
          <div>
            <label htmlFor="rq-email" className="label">
              E-Mail
            </label>
            <input
              id="rq-email"
              name="email"
              type="email"
              className="input"
              defaultValue={state.values?.email ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rq-start" className="label">
                Von
              </label>
              <input
                id="rq-start"
                name="startDate"
                type="date"
                className="input"
                defaultValue={state.values?.startDate ?? ""}
              />
            </div>
            <div>
              <label htmlFor="rq-end" className="label">
                Bis
              </label>
              <input
                id="rq-end"
                name="endDate"
                type="date"
                className="input"
                defaultValue={state.values?.endDate ?? ""}
              />
            </div>
          </div>
          <div>
            <label htmlFor="rq-purpose" className="label">
              Verwendungsort / Zweck
            </label>
            <input
              id="rq-purpose"
              name="purpose"
              className="input"
              defaultValue={state.values?.purpose ?? ""}
            />
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">
              Abbrechen
            </button>
            <button type="submit" disabled={pending} className="btn-primary">
              Anfrage senden
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
