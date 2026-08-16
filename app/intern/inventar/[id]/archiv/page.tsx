// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireInventoryBoardAccess } from "@/lib/inventory";
import { listInventoryItems } from "@/lib/inventory-items";
import {
  conditionClass,
  conditionLabel,
} from "@/lib/inventory-condition";
import { LiveRefresh } from "@/components/LiveRefresh";

export const metadata = { title: "Inventar-Archiv — Gremio" };

export default async function InventoryArchivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { board } = await requireInventoryBoardAccess(Number(id));
  const items = await listInventoryItems(board.id, ["defect", "lost"]);

  return (
    <div className="space-y-5">
      <LiveRefresh src={`/api/inventory/board/${board.id}/stream`} />
      <div>
        <Link
          href={`/intern/inventar/${board.id}`}
          className="text-sm text-brand-600"
        >
          ← {board.name}
        </Link>
        <h1 className="text-2xl font-bold">Archiv</h1>
        <p className="text-sm text-slate-500">
          Defekte und verloren gegangene Gegenstände — zur Nachvollziehbarkeit.
          Über den Gegenstand lässt sich der Zustand wieder ändern.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Keine archivierten Gegenstände.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Bezeichnung</th>
                <th className="px-3 py-2 font-medium">Inv.-Nr.</th>
                <th className="px-3 py-2 font-medium">Zustand</th>
                <th className="px-3 py-2 font-medium">Notiz</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-3 py-2 align-top">
                    <Link
                      href={`/intern/inventar/item/${it.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {it.name || "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 align-top">{it.number ?? "—"}</td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${conditionClass(it.condition)}`}
                    >
                      {conditionLabel(it.condition)}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-600">
                    {it.conditionNote || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
