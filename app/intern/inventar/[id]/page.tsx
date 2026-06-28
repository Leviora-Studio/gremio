// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireInventoryBoardAccess, canManageInventoryBoard } from "@/lib/inventory";

export default async function InventoryBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, board } = await requireInventoryBoardAccess(Number(id));
  const manage = canManageInventoryBoard(user, board);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/intern/inventar" className="text-sm text-brand-600">
            ← Inventar
          </Link>
          <h1 className="text-2xl font-bold">{board.name}</h1>
          {board.description && (
            <p className="text-sm text-slate-500">{board.description}</p>
          )}
        </div>
        {manage && (
          <Link
            href={`/intern/inventar/${board.id}/einstellungen`}
            className="btn-secondary"
          >
            ⚙ Einstellungen
          </Link>
        )}
      </div>

      <div className="card p-8 text-center text-slate-500">
        Noch keine Gegenstände. Das Erfassen von Gegenständen (Felder, Kategorien,
        Standorte, Entleihstatus …) kommt im nächsten Schritt.
      </div>
    </div>
  );
}
