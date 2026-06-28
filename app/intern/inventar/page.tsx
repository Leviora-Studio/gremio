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
