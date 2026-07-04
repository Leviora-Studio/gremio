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

// Eine Tabellenzeile: entweder ein Einzelstück oder ein Sammel-Posten (Gruppe).
type Row = {
  key: string;
  name: string;
  categoryNames: string[];
  isGroup: boolean;
  groupName: string | null;
  total: number; // Stückzahl gesamt (nur bei Gruppe > 1 relevant)
  available: number; // aktuell verfügbare Stückzahl
  item: PublicInventoryItem; // Repräsentant (für Einzel-Anfrage)
};

// Ziel eines Anfrage-Dialogs.
type RequestTarget =
  | { kind: "single"; item: PublicInventoryItem }
  | { kind: "group"; groupName: string; name: string; available: number };

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
  const [requestTarget, setRequestTarget] = useState<RequestTarget | null>(
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

  // Gleiche Artikel/Gruppe zu einem Sammel-Posten bündeln (Stückzahl); Stücke
  // ohne Gruppe bleiben einzeln.
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
    const groupRows: Row[] = [...map.entries()].map(([name, its]) => ({
      key: `g:${name}`,
      name,
      categoryNames: its[0].categoryNames,
      isGroup: true,
      groupName: name,
      total: its.length,
      available: its.filter((i) => i.availability === "available").length,
      item: its[0],
    }));
    const singleRows: Row[] = singles.map((it) => ({
      key: `i:${it.id}`,
      name: it.name,
      categoryNames: it.categoryNames,
      isGroup: false,
      groupName: null,
      total: 1,
      available: it.availability === "available" ? 1 : 0,
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
                        {r.isGroup && (
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
                      {r.isGroup ? (
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
                      <button
                        type="button"
                        disabled={r.available === 0}
                        onClick={() =>
                          setRequestTarget(
                            r.isGroup
                              ? {
                                  kind: "group",
                                  groupName: r.groupName as string,
                                  name: r.name,
                                  available: r.available,
                                }
                              : { kind: "single", item: r.item },
                          )
                        }
                        className="btn-secondary px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Anfragen
                      </button>
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

      {requestTarget && (
        <RequestModal
          boardId={boardId}
          target={requestTarget}
          onClose={() => setRequestTarget(null)}
        />
      )}
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

function RequestModal({
  boardId,
  target,
  onClose,
}: {
  boardId: number;
  target: RequestTarget;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    createInventoryLoanRequestAction,
    {} as RequestState,
  );
  const isGroup = target.kind === "group";
  const name = isGroup ? target.name : target.item.name;

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
          <h2 className="text-lg font-bold">
            {isGroup ? "Artikel anfragen" : "Gegenstand anfragen"}
          </h2>
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
          <strong>{name}</strong>
          {isGroup && (
            <span className="text-slate-500">
              {" "}
              — {target.available} Stück verfügbar
            </span>
          )}
        </p>

        <form action={action} noValidate className="space-y-3">
          {isGroup ? (
            <>
              <input type="hidden" name="boardId" value={boardId} />
              <input type="hidden" name="groupName" value={target.groupName} />
              <div>
                <label htmlFor="rq-qty" className="label">
                  Stückzahl
                </label>
                <input
                  id="rq-qty"
                  name="quantity"
                  type="number"
                  min={1}
                  max={target.available}
                  className="input w-28"
                  defaultValue={state.values?.quantity ?? "1"}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Konkrete Stücke werden automatisch reserviert.
                </p>
              </div>
            </>
          ) : (
            <input type="hidden" name="itemId" value={target.item.id} />
          )}
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
