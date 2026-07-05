// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOverviewItems } from "@/lib/inventory-overview";
import { conditionLabel } from "@/lib/inventory-condition";
import { OverviewExport } from "@/components/inventory/OverviewExport";

export const metadata = { title: "Gesamtinventar — Gremio" };

function euro(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/**
 * Read-only Anlagenverzeichnis: board-übergreifende Gesamtübersicht. Sichtbar
 * für jeden eingeloggten Nutzer; die Einstellungen (Boards, Mindestpreis) macht
 * nur der Admin unter /admin/inventar/gesamt.
 */
export default async function InventoryOverviewViewPage() {
  const user = await requireUser();
  const overview = await getOverviewItems();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/intern/inventar" className="text-sm text-brand-600">
            ← Inventar
          </Link>
          <h1 className="text-2xl font-bold">
            Gesamtinventar (Anlagenverzeichnis)
          </h1>
          <p className="text-sm text-slate-500">
            Board-übergreifende Übersicht aller Artikel ab einem Mindestpreis —
            einzeln gelistet für gesetzliche Nachweise. Nur Ansicht.
          </p>
        </div>
        {user.role === "admin" && (
          <Link
            href="/admin/inventar/gesamt"
            className="btn-secondary shrink-0"
          >
            Einstellungen
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          Artikel ({overview.items.length}) — Gesamtwert {euro(overview.total)}
        </h2>
        <OverviewExport />
      </div>

      {overview.items.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Keine Artikel im Anlagenverzeichnis. Der Admin legt unter{" "}
          <code>Einstellungen</code> fest, welche Inventare ab welchem
          Mindestpreis einfließen.
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
                <th className="px-3 py-2 text-right font-medium">Preis</th>
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
