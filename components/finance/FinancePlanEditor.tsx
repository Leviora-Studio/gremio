// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { PlanItemRow } from "@/components/finance/PlanItemRow";
import { SubmitButton } from "@/components/SubmitButton";
import { centsToInput, formatCents } from "@/lib/money";
import type { financePlanItems } from "@/lib/db/schema";
import { addPlanItemAction, editPlanItemAction, deletePlanItemAction } from "@/app/finanzen/actions";

export function FinancePlanEditor({ fbId, items }: { fbId: number; items: (typeof financePlanItems.$inferSelect)[] }) {
  const tops = items.filter(item => item.parentId == null);
  const childrenOf = (id: number) => items.filter(item => item.parentId === id);
  const renderTop = (top: (typeof tops)[number]) => {
    const kids = childrenOf(top.id);
    const childSum = kids.reduce((s, k) => s + (k.plannedAmount ?? 0), 0);
    const mismatch =
      kids.length > 0 &&
      top.plannedAmount != null &&
      childSum !== top.plannedAmount;
    return (
      <div key={top.id} className="space-y-2 rounded-md border border-slate-200 p-3">
        <PlanItemRow
          item={{
            id: top.id,
            haushaltstitel: top.haushaltstitel,
            title: top.title,
            plannedAmount: centsToInput(top.plannedAmount),
          }}
          editAction={editPlanItemAction.bind(null, top.id)}
          deleteAction={deletePlanItemAction.bind(null, top.id)}
        />
        {mismatch && (
          <p className="ml-1 text-sm text-amber-700">
            ⚠ Summe der Unterpunkte ({formatCents(childSum)}) weicht vom
            Oberpunkt ({formatCents(top.plannedAmount)}) ab.
          </p>
        )}
        {kids.map((k) => (
          <PlanItemRow
            key={k.id}
            child
            item={{
              id: k.id,
              haushaltstitel: k.haushaltstitel,
              title: k.title,
              plannedAmount: centsToInput(k.plannedAmount),
            }}
            editAction={editPlanItemAction.bind(null, k.id)}
            deleteAction={deletePlanItemAction.bind(null, k.id)}
          />
        ))}
        <form
          action={addPlanItemAction.bind(null, fbId, top.id, top.kind)}
          className="ml-6"
        >
          <SubmitButton className="btn-secondary btn-sm">
            + Unterpunkt
          </SubmitButton>
        </form>
      </div>
    );
  };

  return <div className="space-y-6"><p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">Änderungen werden automatisch gespeichert. Der Speicherstatus wird an jeder Position angezeigt.</p>{(["income", "expense"] as const).map(kind => <section key={kind} className="space-y-3">
    <h2 className="font-semibold">{kind === "income" ? "Einnahmen" : "Ausgaben"}</h2>
    {tops.filter(top => top.kind === kind).map(renderTop)}
    <form action={addPlanItemAction.bind(null, fbId, null, kind)}><SubmitButton className="btn-secondary">+ {kind === "income" ? "Einnahme" : "Ausgabe"} (Oberpunkt)</SubmitButton></form>
  </section>)}</div>;
}
