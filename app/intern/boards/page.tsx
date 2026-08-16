// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";
import { sortByUserBoardOrder } from "@/lib/board-order";
import { SortableBoardGrid } from "@/components/SortableBoardGrid";
import { reorderBoardsAction } from "../actions";

export const metadata = { title: "Boards — Gremio" };

export default async function BoardsPage() {
  const user = await requireUser();
  const boards = await sortByUserBoardOrder(
    user.id,
    await getAccessibleBoards(user),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Deine Boards</h1>
        <Link href="/intern/board/neu" className="btn-primary">
          + Neues Board
        </Link>
      </div>

      {boards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          <p>Du hast noch keine Boards.</p>
          <p className="mt-1 text-sm">
            Erstelle ein eigenes Board oder lass dir eines freigeben.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Tipp: Karten am Griff (⠿) ziehen, um deine Reihenfolge festzulegen.
          </p>
          <SortableBoardGrid
            hrefBase="/intern/board/"
            action={reorderBoardsAction}
            boards={boards.map((b) => ({
              id: b.id,
              name: b.name,
              description: b.description,
              isOwner: b.ownerId === user.id,
              isSystemBoard: b.inventoryBoardId != null,
            }))}
          />
        </>
      )}
    </div>
  );
}
