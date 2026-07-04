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
import {
  listBoardActiveLoans,
  listBoardPendingLoans,
} from "@/lib/inventory-loans";
import {
  loanStageClass,
  loanStageLabel,
} from "@/lib/inventory-loan-stage";
import { InventoryBoardView } from "@/components/inventory/InventoryBoardView";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { LiveRefresh } from "@/components/LiveRefresh";

function fmtDate(s: string | null): string {
  if (!s) return "";
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-");
  const date = d ? `${d}.${m}.${y}` : datePart;
  return timePart ? `${date}, ${timePart} Uhr` : date;
}

export default async function InventoryBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, board } = await requireInventoryBoardAccess(Number(id));
  const manage = canManageInventoryBoard(user, board);

  const [visible, options, numbering, items, archived, pending, activeLoans] =
    await Promise.all([
      getVisibleInventoryFieldKeys(board.id),
      getInventoryOptions(board.id),
      getInventoryNumbering(board.id),
      listInventoryItems(board.id, ["active"]),
      listInventoryItems(board.id, ["defect", "lost"]),
      listBoardPendingLoans(board.id),
      listBoardActiveLoans(board.id),
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
        <div className="flex items-center gap-2">
          <Link
            href={`/intern/inventar/${board.id}/archiv`}
            className="btn-secondary"
          >
            Archiv{archived.length > 0 ? ` (${archived.length})` : ""}
          </Link>
          {manage && (
            <Link
              href={`/intern/inventar/${board.id}/einstellungen`}
              className="btn-secondary"
            >
              ⚙ Einstellungen
            </Link>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <CollapsibleSection
          title={`Offene Anfragen (${pending.length})`}
          className="border-blue-200"
          defaultOpen
        >
          <ul className="space-y-1.5">
            {pending.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/intern/inventar/loan/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2 text-sm transition hover:bg-blue-50"
                >
                  <span>
                    <strong>{l.itemName}</strong> · {l.borrower}
                    {l.borrowerEmail ? ` · ${l.borrowerEmail}` : ""}
                  </span>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${loanStageClass(l.status)}`}
                  >
                    {loanStageLabel(l.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {activeLoans.length > 0 && (
        <CollapsibleSection
          title={`Laufende Ausleihe (${activeLoans.length})`}
          className="border-amber-200"
          defaultOpen
        >
          <ul className="space-y-1.5">
            {activeLoans.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/intern/inventar/loan/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-sm transition hover:bg-amber-50"
                >
                  <span>
                    <strong>{l.itemName}</strong> · {l.borrower}
                    {l.endDate ? ` · bis ${fmtDate(l.endDate)}` : ""}
                  </span>
                  <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    entliehen
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
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
