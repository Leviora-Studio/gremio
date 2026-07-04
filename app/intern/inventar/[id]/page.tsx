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
  listInventoryBoardLoanCards,
  type BoardLoanCard,
} from "@/lib/inventory-loans";
import {
  loanStageClass,
  loanStageLabel,
} from "@/lib/inventory-loan-stage";
import { InventoryBoardView } from "@/components/inventory/InventoryBoardView";
import { InventoryExport } from "@/components/inventory/InventoryExport";
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

  const [
    visible,
    options,
    numbering,
    items,
    archived,
    pending,
    activeLoans,
    loanCards,
  ] = await Promise.all([
    getVisibleInventoryFieldKeys(board.id),
    getInventoryOptions(board.id),
    getInventoryNumbering(board.id),
    listInventoryItems(board.id, ["active"]),
    listInventoryItems(board.id, ["defect", "lost"]),
    listBoardPendingLoans(board.id),
    listBoardActiveLoans(board.id),
    board.loanBoardId
      ? listInventoryBoardLoanCards(board.id)
      : Promise.resolve([] as BoardLoanCard[]),
  ]);

  // Aufgabentracking: kartengeführte Vorgänge in der kompakten Kanban-Übersicht;
  // Vorgänge OHNE Karte (Altbestand) bleiben in den klassischen Listen sichtbar.
  const trackingOn = board.loanBoardId != null;
  const pendingLegacy = pending.filter((l) => l.cardId == null);
  const activeLegacy = activeLoans.filter((l) => l.cardId == null);
  const loanColumns: { id: number; name: string; cards: BoardLoanCard[] }[] = [];
  for (const lc of loanCards) {
    let col = loanColumns.find((c) => c.id === lc.columnId);
    if (!col) {
      col = { id: lc.columnId, name: lc.columnName, cards: [] };
      loanColumns.push(col);
    }
    col.cards.push(lc);
  }

  const toOpts = (rows: { id: number; name: string }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));

  // Bestehende Artikel/Gruppen-Namen (aktiv + archiviert) für die suchbare Auswahl.
  const groupNames = Array.from(
    new Set(
      [...items, ...archived]
        .map((it) => (it.groupName ?? "").trim())
        .filter((g) => g !== ""),
    ),
  ).sort((a, b) => a.localeCompare(b, "de"));

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
        <div className="flex flex-wrap items-center gap-2">
          <InventoryExport boardId={board.id} />
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

      {/* Aufgabentracking aktiv: kompakte Kanban-Übersicht der laufenden Vorgänge */}
      {trackingOn && loanCards.length > 0 && (
        <CollapsibleSection
          title={`Laufende Vorgänge (${loanCards.length})`}
          className="border-slate-200"
          defaultOpen
        >
          <div className="mb-2 flex justify-end">
            <Link
              href={`/intern/board/${board.loanBoardId}`}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Auf dem Board öffnen →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {loanColumns.map((col) => (
              <div
                key={col.id}
                className="min-w-[170px] flex-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-600">
                    {col.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-600">
                    {col.cards.length}
                  </span>
                </div>
                <ul className="space-y-1">
                  {col.cards.map((lc) => (
                    <li key={lc.loanId}>
                      <Link
                        href={`/intern/inventar/loan/${lc.loanId}`}
                        className="block rounded border border-slate-200 bg-white px-2 py-1 text-xs transition hover:bg-brand-50"
                      >
                        <span className="font-medium text-slate-800">
                          {lc.itemName}
                        </span>
                        <span className="text-slate-500"> · {lc.borrower}</span>
                        {lc.endDate && (
                          <span className="block text-[10px] text-slate-400">
                            bis {fmtDate(lc.endDate)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {pendingLegacy.length > 0 && (
        <CollapsibleSection
          title={`Offene Anfragen (${pendingLegacy.length})`}
          className="border-blue-200"
          defaultOpen
        >
          <ul className="space-y-1.5">
            {pendingLegacy.map((l) => (
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

      {activeLegacy.length > 0 && (
        <CollapsibleSection
          title={`Laufende Ausleihe (${activeLegacy.length})`}
          className="border-amber-200"
          defaultOpen
        >
          <ul className="space-y-1.5">
            {activeLegacy.map((l) => (
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
        groupNames={groupNames}
        items={items}
      />
    </div>
  );
}
