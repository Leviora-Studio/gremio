// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardTemplates, boardTemplateStatuses } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { RenameTemplateForm } from "@/components/admin/RenameTemplateForm";
import { TemplateStatusList } from "@/components/admin/TemplateStatusList";
import { addTemplateStatusAction } from "../actions";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTemplateManager();
  const { id } = await params;
  const templateId = Number(id);
  const [tpl] = await db
    .select()
    .from(boardTemplates)
    .where(eq(boardTemplates.id, templateId))
    .limit(1);
  if (!tpl) notFound();

  const statuses = await db
    .select()
    .from(boardTemplateStatuses)
    .where(eq(boardTemplateStatuses.templateId, templateId))
    .orderBy(asc(boardTemplateStatuses.position));

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/vorlagen/boards" className="text-sm text-brand-600">
        ← Zurück zu Templates
      </Link>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Template bearbeiten</h2>
        <RenameTemplateForm
          templateId={tpl.id}
          name={tpl.name}
          description={tpl.description}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-lg font-semibold">Spalten</h2>
        <p className="mb-3 text-xs text-slate-500">
          Zum Sortieren am Griff (⠿) ziehen.
        </p>
        {statuses.length === 0 ? (
          <p className="text-sm text-slate-500">
            Noch keine Spalten — Boards aus diesem Template hätten keine Spalten.
            Füge unten welche hinzu.
          </p>
        ) : (
          <TemplateStatusList
            templateId={templateId}
            statuses={statuses.map((s) => ({ id: s.id, name: s.name }))}
          />
        )}

        <form
          action={addTemplateStatusAction.bind(null, templateId)}
          className="mt-3 flex items-end gap-2"
        >
          <div className="flex-1">
            <label className="label">Neue Spalte</label>
            <input name="name" className="input" placeholder="Spaltenname" />
          </div>
          <SubmitButton className="btn-primary">Hinzufügen</SubmitButton>
        </form>
      </section>
    </div>
  );
}
