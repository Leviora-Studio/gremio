// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import type { AntragRow } from "@/lib/finance-data";

type SortKey =
  | "number"
  | "budgetTitle"
  | "title"
  | "applicant"
  | "decisionRef"
  | "instructionDate"
  | "approvedAmount"
  | "actualAmount";

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric?: boolean;
  right?: boolean;
}[] = [
  { key: "number", label: "Antragsnr." },
  { key: "budgetTitle", label: "Haushaltstitel" },
  { key: "title", label: "Titel" },
  { key: "applicant", label: "Antragsteller" },
  { key: "decisionRef", label: "Beschlussreferenz" },
  { key: "instructionDate", label: "Anweisung" },
  { key: "approvedAmount", label: "Genehmigt", numeric: true, right: true },
  { key: "actualAmount", label: "Getätigt", numeric: true, right: true },
];

export function AntraegeTable({ rows }: { rows: AntragRow[] }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("number");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = term
      ? rows.filter((c) =>
          [c.number, c.budgetTitle, c.title, c.applicant, c.decisionRef, c.instructionDate]
            .some((v) => (v ?? "").toLowerCase().includes(term)),
        )
      : rows;

    const numeric = COLUMNS.find((c) => c.key === sortKey)?.numeric;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      // Leere Werte immer ans Ende.
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
      const cmp = numeric
        ? (av as number) - (bv as number)
        : String(av).localeCompare(String(bv), "de", { numeric: true });
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, q, sortKey, dir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir("asc");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input w-64"
          placeholder="Anträge durchsuchen …"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-slate-400">
          {visible.length} von {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`py-2 pr-3 ${col.right ? "text-right" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 uppercase hover:text-slate-700"
                    title="Sortieren"
                  >
                    {col.label}
                    <span className="text-[10px] text-slate-400">
                      {sortKey === col.key ? (dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-3 text-slate-500">
                  Keine passenden Anträge.
                </td>
              </tr>
            )}
            {visible.map((c) => (
              <tr key={c.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-medium">
                  {c.number ? (
                    <Link
                      href={`/intern/card/${c.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {c.number}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3">{c.budgetTitle}</td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/intern/card/${c.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    {c.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{c.applicant || "—"}</td>
                <td className="py-2 pr-3">{c.decisionRef ?? "—"}</td>
                <td className="py-2 pr-3">{c.instructionDate ?? "—"}</td>
                <td className="py-2 pr-3 text-right">
                  {c.approvedAmount != null ? formatCents(c.approvedAmount) : "—"}
                </td>
                <td className="py-2 text-right">
                  {c.actualAmount != null ? formatCents(c.actualAmount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
