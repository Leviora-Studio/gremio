// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardTemplates, boardTemplateStatuses } from "@/lib/db/schema";
import { CreateTemplateForm } from "@/components/admin/CreateTemplateForm";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteTemplateAction, duplicateTemplateAction } from "./actions";

export default async function TemplatesPage() {
  const rows = await db
    .select({
      id: boardTemplates.id,
      name: boardTemplates.name,
      description: boardTemplates.description,
      columns: sql<number>`(select count(*) from ${boardTemplateStatuses} where ${boardTemplateStatuses.templateId} = ${boardTemplates.id})`,
    })
    .from(boardTemplates)
    .orderBy(asc(boardTemplates.name));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold">Board-Templates</h2>
        <p className="text-sm text-slate-500">
          Vorlagen mit Spalten, aus denen beim Erstellen eines Boards gewählt
          wird. Nach dem Anlegen Spalten im Template hinzufügen.
        </p>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Neues Template anlegen</h3>
        <CreateTemplateForm />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Templates ({rows.length})</h3>
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">Noch keine Templates.</p>
        )}
        {rows.map((t) => (
          <div key={t.id} className="card flex items-center justify-between p-4">
            <div>
              <Link
                href={`/vorlagen/boards/${t.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {t.name}
              </Link>
              <span className="ml-2 text-sm text-slate-500">
                {String(t.columns)} Spalte(n)
              </span>
              {t.description && (
                <p className="text-sm text-slate-500">{t.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/vorlagen/boards/${t.id}`}
                className="btn-secondary px-3"
              >
                Bearbeiten
              </Link>
              <form action={duplicateTemplateAction.bind(null, t.id)}>
                <SubmitButton className="btn-secondary px-3">
                  Duplizieren
                </SubmitButton>
              </form>
              <DeleteConfirm
                action={deleteTemplateAction.bind(null, t.id)}
                compact
                buttonLabel="Löschen"
                buttonClassName="btn-danger px-3"
                title={`Template „${t.name}" löschen`}
                message="Das Template wird gelöscht. Bereits erstellte Boards bleiben unverändert."
              />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
