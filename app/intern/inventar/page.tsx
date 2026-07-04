// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleInventoryBoards } from "@/lib/inventory";
import { sortByUserInventoryBoardOrder } from "@/lib/board-order";
import { SortableBoardGrid } from "@/components/SortableBoardGrid";
import { reorderInventoryBoardsAction } from "./actions";

export const metadata = { title: "Inventar — Gremio" };

export default async function InventarPage() {
  const user = await requireUser();
  const boards = await sortByUserInventoryBoardOrder(
    user.id,
    await getAccessibleInventoryBoards(user),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventar</h1>
          <p className="text-sm text-slate-500">
            Inventar- und Entleihlisten verwalten.
          </p>
        </div>
        <Link href="/intern/inventar/neu" className="btn-primary">
          + Neues Inventar
        </Link>
      </div>

      {/* Anlagenverzeichnis: board-übergreifende Nur-Ansicht (für alle sichtbar,
          Einstellungen nur Admin). */}
      <Link
        href="/intern/inventar/gesamt"
        className="card flex items-center justify-between gap-3 p-4 transition hover:border-brand-300 hover:shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600"
            aria-hidden
          >
            📋
          </span>
          <div>
            <div className="font-medium text-slate-800">Gesamtinventar</div>
            <div className="text-xs text-slate-500">
              Board-übergreifendes Anlagenverzeichnis — nur Ansicht
            </div>
          </div>
        </div>
        <span className="text-slate-300">→</span>
      </Link>

      {boards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          <p>Du hast noch kein Inventar.</p>
          <p className="mt-1 text-sm">
            Lege ein eigenes Inventar an oder lass dir eines freigeben.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Tipp: Karten am Griff (⠿) ziehen, um deine Reihenfolge festzulegen.
          </p>
          <SortableBoardGrid
            hrefBase="/intern/inventar/"
            action={reorderInventoryBoardsAction}
            boards={boards.map((b) => ({
              id: b.id,
              name: b.name,
              description: b.description,
              isOwner: b.ownerId === user.id,
            }))}
          />
        </>
      )}
    </div>
  );
}
