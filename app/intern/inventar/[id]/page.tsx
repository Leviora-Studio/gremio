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
import { listBoardPendingLoans } from "@/lib/inventory-loans";
import {
  loanStageClass,
  loanStageLabel,
} from "@/lib/inventory-loan-stage";
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

  const [visible, options, numbering, items, pending] = await Promise.all([
    getVisibleInventoryFieldKeys(board.id),
    getInventoryOptions(board.id),
    getInventoryNumbering(board.id),
    listInventoryItems(board.id),
    listBoardPendingLoans(board.id),
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

      {pending.length > 0 && (
        <div className="card border-blue-200 bg-blue-50/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-blue-800">
            Offene Anfragen ({pending.length})
          </h2>
          <ul className="space-y-1.5">
            {pending.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/intern/inventar/loan/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm transition hover:bg-blue-50"
                >
                  <span>
                    <strong>{l.itemName}</strong> · {l.borrower}
                    {l.borrowerEmail ? ` · ${l.borrowerEmail}` : ""}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${loanStageClass(l.status)}`}
                  >
                    {loanStageLabel(l.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

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
