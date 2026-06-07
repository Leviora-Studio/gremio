// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleFinanceBoards } from "@/lib/finance";
import { sortByUserFinanceBoardOrder } from "@/lib/board-order";
import { SortableBoardGrid } from "@/components/SortableBoardGrid";
import { reorderFinanceBoardsAction } from "./actions";

export default async function FinanzenPage() {
  const user = await requireUser();
  const boards = await sortByUserFinanceBoardOrder(
    user.id,
    await getAccessibleFinanceBoards(user),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanzübersichten</h1>
        <Link href="/finanzen/neu" className="btn-primary">
          + Neue Finanzübersicht
        </Link>
      </div>

      {boards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          <p>Noch keine Finanzübersicht.</p>
          <p className="mt-1 text-sm">
            Lege oben rechts über „+ Neue Finanzübersicht" eine an.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Tipp: Karten am Griff (⠿) ziehen, um deine Reihenfolge festzulegen.
          </p>
          <SortableBoardGrid
            hrefBase="/finanzen/"
            action={reorderFinanceBoardsAction}
            boards={boards.map((fb) => ({
              id: fb.id,
              name: fb.name,
              description: fb.description,
              isOwner: fb.ownerId === user.id,
            }))}
          />
        </>
      )}
    </div>
  );
}
