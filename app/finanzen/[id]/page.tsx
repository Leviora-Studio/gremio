// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import {
  requireFinanceAccess,
  canManageFinanceBoard,
} from "@/lib/finance";
import { loadFinanceData, type PlanItem } from "@/lib/finance-data";
import { formatCents } from "@/lib/money";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { ExpenseTree } from "@/components/finance/ExpenseTree";
import { ExportButtons } from "@/components/finance/ExportButtons";
import { AntraegeTable } from "@/components/finance/AntraegeTable";

export default async function FinanceBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fbId = Number(id);
  const { user, fb } = await requireFinanceAccess(fbId);
  const manage = canManageFinanceBoard(user, fb);

  const {
    accountNames,
    expenseAccountNames,
    expenseAccountsOverridden,
    accessibleCount,
    inaccessible,
    incomeTops,
    expenseTops,
    childrenOf,
    cardRows,
    live,
    actual,
  } = await loadFinanceData(fb);

  // Hinweis in den Ausgaben-Tabs, wenn ein abweichender Konten-Override gilt.
  const expenseNote = expenseAccountsOverridden ? (
    <p className="mb-3 rounded bg-blue-50 p-2 text-xs text-blue-700">
      Berechnet nur aus {expenseAccountNames.length > 1 ? "Konten" : "Konto"}:{" "}
      {expenseAccountNames.join(", ")} (eingeschränkt in den Einstellungen).
    </p>
  ) : null;
  const hasPlan = incomeTops.length + expenseTops.length > 0;

  // View 1: Haushaltsplan (read-only) — Einnahmen und Ausgaben klar getrennt.
  const planTopRow = (top: PlanItem) => {
    const kids = childrenOf(top.id);
    const childSum = kids.reduce((s, k) => s + (k.plannedAmount ?? 0), 0);
    const mismatch =
      kids.length > 0 &&
      top.plannedAmount != null &&
      childSum !== top.plannedAmount;
    return (
      <div key={top.id} className="rounded-md border border-slate-200 p-3">
        <div className="flex items-center justify-between font-medium">
          <span>
            {top.haushaltstitel && (
              <span className="text-slate-500">{top.haushaltstitel} </span>
            )}
            {top.title || "(ohne Bezeichnung)"}
          </span>
          <span>{formatCents(top.plannedAmount)}</span>
        </div>
        {mismatch && (
          <p className="text-sm text-amber-700">
            ⚠ Summe der Unterpunkte ({formatCents(childSum)}) weicht ab.
          </p>
        )}
        {kids.map((k) => (
          <div
            key={k.id}
            className="ml-4 flex items-center justify-between border-t border-slate-100 py-1 text-sm"
          >
            <span>
              {k.haushaltstitel && (
                <span className="text-slate-500">{k.haushaltstitel} </span>
              )}
              {k.title || "(ohne Bezeichnung)"}
            </span>
            <span>{formatCents(k.plannedAmount)}</span>
          </div>
        ))}
      </div>
    );
  };

  const planGroup = (
    label: string,
    groupTops: PlanItem[],
    labelClass: string,
  ) => {
    const sum = groupTops.reduce((s, t) => s + (t.plannedAmount ?? 0), 0);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${labelClass}`}>
            {label}
          </h3>
          <span className="font-semibold">{formatCents(sum)}</span>
        </div>
        {groupTops.length === 0 ? (
          <p className="text-xs text-slate-400">— keine —</p>
        ) : (
          groupTops.map(planTopRow)
        )}
      </div>
    );
  };

  const planView = (
    <div className="space-y-6">
      {!hasPlan ? (
        <p className="text-sm text-slate-500">
          Noch kein Haushaltsplan angelegt (in den Einstellungen).
        </p>
      ) : (
        <>
          {planGroup("Einnahmen", incomeTops, "text-green-700")}
          {planGroup("Ausgaben", expenseTops, "text-slate-600")}
        </>
      )}
    </div>
  );

  // View 4: Anträge (Suche + Sortierung clientseitig)
  const antraegeView = <AntraegeTable rows={cardRows} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/finanzen" className="text-sm text-brand-600">
            ← Finanzübersichten
          </Link>
          <h1 className="text-2xl font-bold">{fb.name}</h1>
          <p className="text-sm text-slate-500">
            {accountNames.length > 1 ? "Konten" : "Konto"}:{" "}
            {accountNames.length ? accountNames.join(", ") : "— (in Einstellungen wählen)"} ·
            Quell-Boards: {accessibleCount}
          </p>
        </div>
        {manage && (
          <Link href={`/finanzen/${fbId}/einstellungen`} className="btn-secondary">
            ⚙ Einstellungen
          </Link>
        )}
      </div>

      {accountNames.length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-700">
          Bitte in den Einstellungen mindestens ein „betroffenes Konto" und
          Quell-Boards wählen, damit Ausgaben geladen werden.
        </p>
      )}
      {inaccessible.length > 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-700">
          ⚠ Daten könnten fehlen: Der Eigentümer dieser Finanzübersicht hat
          aktuell keinen Zugriff auf {inaccessible.length} verknüpfte(s)
          Quell-Board(s) ({inaccessible.map((s) => s.name).join(", ")}). Diese
          Karten werden nicht berücksichtigt.
        </p>
      )}

      <FinanceTabs
        tabs={[
          {
            key: "antraege",
            label: `Anträge (${cardRows.length})`,
            content: (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                  <ExportButtons
                    fbId={fbId}
                    view="antraege"
                    label="Nach Haushaltstitel:"
                    className="flex items-center gap-2"
                  />
                  <ExportButtons
                    fbId={fbId}
                    view="antraege_nr"
                    label="Nach Antragsnummer:"
                    className="flex items-center gap-2"
                  />
                </div>
                {antraegeView}
              </>
            ),
          },
          {
            key: "live",
            label: "Live-Ausgaben",
            content: (
              <>
                <ExportButtons fbId={fbId} view="live" />
                {expenseNote}
                <ExpenseTree
                  rows={live.rows}
                  unmatched={live.unmatched}
                  spentTotal={live.spentTotal}
                />
              </>
            ),
          },
          {
            key: "actual",
            label: "Tatsächliche Ausgaben",
            content: (
              <>
                <ExportButtons fbId={fbId} view="actual" />
                {expenseNote}
                <ExpenseTree
                  rows={actual.rows}
                  unmatched={actual.unmatched}
                  spentTotal={actual.spentTotal}
                />
              </>
            ),
          },
          {
            key: "plan",
            label: "Haushaltsplan",
            content: (
              <>
                <ExportButtons fbId={fbId} view="plan" />
                {planView}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
