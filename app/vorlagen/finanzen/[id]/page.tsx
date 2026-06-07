// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeTemplates, financeTemplateItems } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";
import { centsToInput, formatCents } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";
import { RenameFinanceTemplateForm } from "@/components/admin/RenameFinanceTemplateForm";
import { PlanItemRow } from "@/components/finance/PlanItemRow";
import {
  addFinanceTemplateItemAction,
  deleteFinanceTemplateItemAction,
  editFinanceTemplateItemAction,
} from "../actions";

export default async function FinanceTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTemplateManager();
  const { id } = await params;
  const tId = Number(id);
  const [tpl] = await db
    .select()
    .from(financeTemplates)
    .where(eq(financeTemplates.id, tId))
    .limit(1);
  if (!tpl) notFound();

  const items = await db
    .select()
    .from(financeTemplateItems)
    .where(eq(financeTemplateItems.templateId, tId))
    .orderBy(asc(financeTemplateItems.position));
  const tops = items.filter((i) => i.parentId == null);
  const childrenOf = (pid: number) => items.filter((i) => i.parentId === pid);

  const renderTop = (top: (typeof items)[number]) => {
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
          editAction={editFinanceTemplateItemAction.bind(null, top.id)}
          deleteAction={deleteFinanceTemplateItemAction.bind(null, top.id)}
        />
        {mismatch && (
          <p className="ml-1 text-sm text-amber-700">
            ⚠ Summe der Unterpunkte ({formatCents(childSum)}) weicht ab.
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
            editAction={editFinanceTemplateItemAction.bind(null, k.id)}
            deleteAction={deleteFinanceTemplateItemAction.bind(null, k.id)}
          />
        ))}
        <form
          action={addFinanceTemplateItemAction.bind(null, tId, top.id, "expense")}
          className="ml-6"
        >
          <SubmitButton className="btn-secondary btn-sm">
            + Unterpunkt
          </SubmitButton>
        </form>
      </div>
    );
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/vorlagen/finanzen" className="text-sm text-brand-600">
        ← Zurück zu Finanz-Templates
      </Link>
      <h1 className="text-2xl font-bold">Finanz-Template: {tpl.name}</h1>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold">Name</h2>
        <RenameFinanceTemplateForm
          id={tId}
          name={tpl.name}
          description={tpl.description}
        />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold">Haushaltsplan-Vorlage</h2>
        <p className="text-sm text-slate-500">
          Getrennt nach Einnahmen und Ausgaben. Ober-/Unterpunkte mit geplanten
          Beträgen — wird beim Anlegen einer Finanzübersicht in deren
          Haushaltsplan kopiert.
        </p>

        {(["income", "expense"] as const).map((kind) => (
          <div key={kind} className="space-y-3">
            <h3
              className={`text-sm font-semibold ${
                kind === "income" ? "text-green-700" : "text-slate-700"
              }`}
            >
              {kind === "income" ? "Einnahmen" : "Ausgaben"}
            </h3>
            {tops.filter((t) => t.kind === kind).map(renderTop)}
            <form
              action={addFinanceTemplateItemAction.bind(null, tId, null, kind)}
            >
              <SubmitButton className="btn-primary">
                + {kind === "income" ? "Einnahme" : "Ausgabe"}-Oberpunkt
              </SubmitButton>
            </form>
          </div>
        ))}
      </section>
    </div>
  );
}
