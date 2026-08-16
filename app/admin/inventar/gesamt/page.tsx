// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryBoards } from "@/lib/db/schema";
import { getOverviewItems } from "@/lib/inventory-overview";
import { conditionLabel } from "@/lib/inventory-condition";
import { OverviewExport } from "@/components/inventory/OverviewExport";
import { SubmitButton } from "@/components/SubmitButton";
import {
  setOverviewMinPriceAction,
  toggleBoardOverviewAction,
} from "./actions";

export const metadata = { title: "Inventar-Gesamtübersicht — Gremio" };

function euro(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export default async function InventoryOverviewPage() {
  await requireAdmin();
  const [boards, overview] = await Promise.all([
    db
      .select({
        id: inventoryBoards.id,
        name: inventoryBoards.name,
        includeInOverview: inventoryBoards.includeInOverview,
      })
      .from(inventoryBoards)
      .orderBy(asc(inventoryBoards.name)),
    getOverviewItems(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/inventar" className="text-sm text-brand-600">
            ← Inventar
          </Link>
          <h2 className="text-lg font-semibold">
            Gesamtübersicht — Einstellungen
          </h2>
          <p className="text-sm text-slate-500">
            Lege fest, welche Inventare ab welchem Mindestpreis ins
            Anlagenverzeichnis einfließen. Die reine Ansicht sehen alle Nutzer
            unter Inventar → Gesamtinventar.
          </p>
        </div>
        <Link
          href="/intern/inventar/gesamt"
          className="btn-secondary shrink-0"
        >
          Zur Ansicht
        </Link>
      </div>

      {/* Einstellungen */}
      <div className="card space-y-4 p-5">
        <form
          action={setOverviewMinPriceAction}
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label htmlFor="minPrice" className="label">
              Mindestpreis (€)
            </label>
            <input
              id="minPrice"
              name="minPrice"
              inputMode="decimal"
              className="input w-40"
              defaultValue={(overview.minPrice / 100).toFixed(2).replace(".", ",")}
            />
          </div>
          <SubmitButton className="btn-primary">Übernehmen</SubmitButton>
        </form>

        <div>
          <p className="label">Einbezogene Inventare</p>
          <div className="space-y-1.5">
            {boards.length === 0 && (
              <p className="text-sm text-slate-500">Keine Inventare vorhanden.</p>
            )}
            {boards.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
              >
                <span className="text-sm text-slate-800">{b.name}</span>
                <span className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      b.includeInOverview
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {b.includeInOverview ? "einbezogen" : "nicht einbezogen"}
                  </span>
                  <form action={toggleBoardOverviewAction}>
                    <input type="hidden" name="boardId" value={b.id} />
                    <input
                      type="hidden"
                      name="include"
                      value={b.includeInOverview ? "0" : "1"}
                    />
                    <SubmitButton className="btn-secondary px-3 py-1 text-sm">
                      {b.includeInOverview ? "Entfernen" : "Einbeziehen"}
                    </SubmitButton>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Artikel ({overview.items.length}) — Gesamtwert {euro(overview.total)}
        </h3>
        <OverviewExport />
      </div>

      {overview.items.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Keine Artikel ≥ Mindestpreis in den einbezogenen Inventaren.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Inventar</th>
                <th className="px-3 py-2 font-medium">Inv.-Nr.</th>
                <th className="px-3 py-2 font-medium">Bezeichnung</th>
                <th className="px-3 py-2 font-medium">Zustand</th>
                <th className="px-3 py-2 font-medium">Seriennr.</th>
                <th className="px-3 py-2 font-medium">Kaufdatum</th>
                <th className="px-3 py-2 font-medium">Händler</th>
                <th className="px-3 py-2 text-right font-medium">Einzelpreis</th>
              </tr>
            </thead>
            <tbody>
              {overview.items.map((it) => (
                <tr
                  key={it.itemId}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2 align-top text-slate-500">
                    {it.boardName}
                  </td>
                  <td className="px-3 py-2 align-top">{it.number ?? "—"}</td>
                  <td className="px-3 py-2 align-top font-medium text-slate-800">
                    {it.name}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {conditionLabel(it.condition)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {it.serialNumber ?? "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {it.purchaseDate ?? "—"}
                  </td>
                  <td className="px-3 py-2 align-top">{it.vendor ?? "—"}</td>
                  <td className="px-3 py-2 text-right align-top">
                    {euro(it.price)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="px-3 py-2" colSpan={7}>
                  Gesamtwert
                </td>
                <td className="px-3 py-2 text-right">{euro(overview.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
