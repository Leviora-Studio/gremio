// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addLoanItemAction,
  removeLoanItemAction,
} from "@/app/intern/inventar/item/[itemId]/actions";

type Unit = {
  id: number;
  number: string | null;
  name: string;
  quantity: number;
};
type Addable = { id: number; number: string | null; name: string; free: number };

/**
 * Stückzahl eines Obergruppen-Vorgangs: zeigt angefragte vs. bestätigte MENGE
 * (Summe der zugeordneten Mengen, nicht die Zeilenzahl) und erlaubt, einzelne
 * Einheiten zuzuordnen/zu entfernen. Bei Mengen-Stücken erhöht bzw. reduziert
 * das die Menge der Zeile; die letzte Einheit des Vorgangs bleibt bestehen.
 */
export function LoanQuantityEditor({
  loanId,
  requested,
  confirmed,
  confirmedLabel,
  items,
  addable,
}: {
  loanId: number;
  requested: number;
  confirmed: number;
  confirmedLabel: string;
  items: Unit[];
  addable: Addable[];
}) {
  const [toAdd, setToAdd] = useState("");
  const baseText = (u: { name: string; number: string | null }) =>
    `${u.name}${u.number ? ` · ${u.number}` : ""}`;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">
            Angefragte Stückzahl
          </dt>
          <dd className="text-lg font-semibold text-slate-800">{requested}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">
            {confirmedLabel}
          </dt>
          <dd className="text-lg font-semibold text-emerald-700">{confirmed}</dd>
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">
          Zugeordnete Stücke
        </p>
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <Link
                href={`/intern/inventar/item/${it.id}`}
                className="font-medium text-slate-800 hover:text-brand-600"
              >
                {baseText(it)}
                {it.quantity > 1 && (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    ×{it.quantity}
                  </span>
                )}
              </Link>
              <form action={removeLoanItemAction}>
                <input type="hidden" name="loanId" value={loanId} />
                <input type="hidden" name="itemId" value={it.id} />
                <SubmitButton
                  disabled={confirmed <= 1}
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  {it.quantity > 1 ? "Eine weniger" : "Entfernen"}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </div>

      {addable.length > 0 ? (
        <form
          action={addLoanItemAction}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <input type="hidden" name="loanId" value={loanId} />
          <div className="min-w-[14rem] flex-1">
            <label className="label">Weitere Einheit zuordnen</label>
            <Select
              name="itemId"
              value={toAdd}
              onChange={setToAdd}
              searchable={addable.length > 8}
              placeholder="Verfügbares Stück wählen…"
              options={[
                { value: "", label: "Verfügbares Stück wählen…" },
                ...addable.map((a) => ({
                  value: String(a.id),
                  label:
                    a.free > 1
                      ? `${baseText(a)} (${a.free} frei)`
                      : baseText(a),
                })),
              ]}
            />
          </div>
          <SubmitButton
            disabled={!addable.some((a) => String(a.id) === toAdd)}
            className="btn-secondary"
          >
            Hinzufügen
          </SubmitButton>
        </form>
      ) : (
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-400">
          Aktuell sind keine weiteren Einheiten dieser Obergruppe verfügbar.
        </p>
      )}
    </div>
  );
}
