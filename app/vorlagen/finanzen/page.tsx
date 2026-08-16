// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeTemplates, financeTemplateItems } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";
import { CreateFinanceTemplateForm } from "@/components/admin/CreateFinanceTemplateForm";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteFinanceTemplateAction,
  duplicateFinanceTemplateAction,
} from "./actions";

export default async function FinanceTemplatesPage() {
  await requireTemplateManager();
  const rows = await db
    .select({
      id: financeTemplates.id,
      name: financeTemplates.name,
      description: financeTemplates.description,
      // Zählung über einen JOIN statt einer korrelierten Subquery im SELECT —
      // siehe die gleichlautende Begründung in app/vorlagen/boards/page.tsx.
      items: sql<number>`count(${financeTemplateItems.id})`,
    })
    .from(financeTemplates)
    .leftJoin(
      financeTemplateItems,
      eq(financeTemplateItems.templateId, financeTemplates.id),
    )
    .groupBy(financeTemplates.id)
    .orderBy(asc(financeTemplates.name));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Finanz-Templates</h2>
        <p className="text-sm text-slate-500">
          Haushaltsplan-Vorlagen, die beim Anlegen einer Finanzübersicht
          ausgewählt werden können.
        </p>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Neues Template anlegen</h3>
        <CreateFinanceTemplateForm />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Templates ({rows.length})</h3>
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">Noch keine Finanz-Templates.</p>
        )}
        {rows.map((t) => (
          <div
            key={t.id}
            className="card flex flex-wrap items-center justify-between gap-2 p-4"
          >
            <div>
              <Link
                href={`/vorlagen/finanzen/${t.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {t.name}
              </Link>
              {t.description && (
                <div className="text-sm text-slate-500">{t.description}</div>
              )}
              <div className="text-xs text-slate-400">
                {t.items} Position(en)
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/vorlagen/finanzen/${t.id}`}
                className="btn-secondary px-3"
              >
                Bearbeiten
              </Link>
              <form action={duplicateFinanceTemplateAction.bind(null, t.id)}>
                <SubmitButton className="btn-secondary px-3">
                  Duplizieren
                </SubmitButton>
              </form>
              <DeleteConfirm
                action={deleteFinanceTemplateAction.bind(null, t.id)}
                compact
                buttonLabel="Löschen"
                buttonClassName="btn-danger px-3"
                title={`Template „${t.name}" löschen`}
                message="Das Finanz-Template wird gelöscht. Bereits erstellte Finanzübersichten bleiben unverändert."
              />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
