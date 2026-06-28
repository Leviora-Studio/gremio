// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import {
  requireInventoryBoardAccess,
  canManageInventoryBoard,
} from "@/lib/inventory";
import { getVisibleInventoryFieldKeys } from "@/lib/inventory-fields";
import {
  getInventoryNumbering,
  getInventoryOptions,
  listInventoryItems,
} from "@/lib/inventory-items";
import { InventoryBoardView } from "@/components/inventory/InventoryBoardView";
import { LiveRefresh } from "@/components/LiveRefresh";

export default async function InventoryBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, board } = await requireInventoryBoardAccess(Number(id));
  const manage = canManageInventoryBoard(user, board);

  const [visible, options, numbering, items] = await Promise.all([
    getVisibleInventoryFieldKeys(board.id),
    getInventoryOptions(board.id),
    getInventoryNumbering(board.id),
    listInventoryItems(board.id),
  ]);

  const toOpts = (rows: { id: number; name: string }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="space-y-5">
      <LiveRefresh src={`/api/inventory/board/${board.id}/stream`} />
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

      <InventoryBoardView
        boardId={board.id}
        visibleFields={Array.from(visible)}
        numberingEnabled={numbering?.enabled ?? false}
        initialOptions={{
          category: toOpts(options.category),
          location: toOpts(options.location),
          loan_status: toOpts(options.loan_status),
        }}
        items={items}
      />
    </div>
  );
}
