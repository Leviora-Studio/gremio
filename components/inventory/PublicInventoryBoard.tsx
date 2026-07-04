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

type Options = {
  category: PublicOpt[];
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
  const [selectedCats, setSelectedCats] = useState<number[]>([]);
  const [requestItem, setRequestItem] = useState<PublicInventoryItem | null>(
    null,
  );

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
                {filtered.map((it) => (
                  <tr
                    key={it.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-2 align-top">
                      {renderCell("name", it)}
                    </td>
                    {showCategory && (
                      <td className="px-3 py-2 align-top">
                        {renderCell("category", it)}
                      </td>
                    )}
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
    default:
      return "—";
  }
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rq-start" className="label">
                Von (Datum + Uhrzeit)
              </label>
              <input
                id="rq-start"
                name="startDate"
                type="datetime-local"
                className="input"
                defaultValue={state.values?.startDate ?? ""}
              />
            </div>
            <div>
              <label htmlFor="rq-end" className="label">
                Bis (Datum + Uhrzeit)
              </label>
              <input
                id="rq-end"
                name="endDate"
                type="datetime-local"
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
