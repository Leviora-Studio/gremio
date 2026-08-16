// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState, type ReactNode } from "react";

export type FilterItem = {
  key: string | number;
  /** Worüber gesucht wird (z. B. Name + Eigentümer). */
  search: string;
  /** Bereits (server-)gerendertes Element der Zeile. */
  element: ReactNode;
};

/**
 * Client-seitige Suche über bereits gerenderte Listenzeilen. Die Serverseite
 * baut die `items` (mit Such-Text + fertigem Element); hier wird nur gefiltert.
 */
export function FilterableList({
  items,
  placeholder = "Suchen…",
  emptyText = "Keine Treffer.",
}: {
  items: FilterItem[];
  placeholder?: string;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? items.filter((it) => it.search.toLowerCase().includes(needle))
    : items;

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="input max-w-sm"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((it) => (
            <div key={it.key}>{it.element}</div>
          ))}
        </div>
      )}
    </div>
  );
}
