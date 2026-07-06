// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addLoanItemAction,
  removeLoanItemAction,
} from "@/app/intern/inventar/item/[itemId]/actions";

type Unit = { id: number; number: string | null; name: string };

/**
 * Stückzahl eines (Gruppen-)Vorgangs: zeigt angefragte vs. bestätigte Menge und
 * erlaubt, konkrete Stücke zuzuordnen/zu entfernen (andere Menge genehmigen).
 */
export function LoanQuantityEditor({
  loanId,
  requested,
  confirmedLabel,
  items,
  addable,
}: {
  loanId: number;
  requested: number;
  confirmedLabel: string;
  items: Unit[];
  addable: Unit[];
}) {
  const [toAdd, setToAdd] = useState("");
  const unitText = (u: Unit) => `${u.name}${u.number ? ` · ${u.number}` : ""}`;

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
          <dd className="text-lg font-semibold text-emerald-700">
            {items.length}
          </dd>
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
                {unitText(it)}
              </Link>
              <form action={removeLoanItemAction}>
                <input type="hidden" name="loanId" value={loanId} />
                <input type="hidden" name="itemId" value={it.id} />
                <SubmitButton
                  disabled={items.length <= 1}
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  Entfernen
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
            <label className="label">Weiteres Stück zuordnen</label>
            <Select
              name="itemId"
              value={toAdd}
              onChange={setToAdd}
              searchable={addable.length > 8}
              placeholder="Verfügbares Stück wählen…"
              options={[
                { value: "", label: "Verfügbares Stück wählen…" },
                ...addable.map((a) => ({ value: String(a.id), label: unitText(a) })),
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
          Aktuell sind keine weiteren Stücke dieser Gruppe verfügbar.
        </p>
      )}
    </div>
  );
}
