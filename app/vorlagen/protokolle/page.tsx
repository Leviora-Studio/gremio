// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { protocolTemplates } from "@/lib/db/schema";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ProtocolTemplateForm } from "@/components/protocols/ProtocolTemplateForm";
import {
  createProtocolTemplateAction,
  deleteProtocolTemplateAction,
  updateProtocolTemplateAction,
} from "./actions";

export default async function ProtocolTemplatesPage() {
  const templates = await db.select().from(protocolTemplates).orderBy(asc(protocolTemplates.name));
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Protokollvorlagen</h2>
        <p className="text-sm text-slate-500">
          Markdown-Vorlagen für neue Sitzungen. Unbekannte Variablen werden abgewiesen.
        </p>
      </div>
      <ProtocolTemplateForm action={createProtocolTemplateAction} />
      <section className="space-y-4">
        {templates.length === 0 && <p className="text-sm text-slate-500">Noch keine Protokollvorlagen.</p>}
        {templates.map((template) => (
          <div key={template.id} className="space-y-2">
            <ProtocolTemplateForm
              action={updateProtocolTemplateAction.bind(null, template.id)}
              initial={template}
            />
            <DeleteConfirm
              action={deleteProtocolTemplateAction.bind(null, template.id)}
              compact
              buttonLabel="Vorlage löschen"
              buttonClassName="btn-danger btn-sm"
              title={`Protokollvorlage „${template.name}" löschen`}
              message="Die Vorlage wird gelöscht. Verwendete Vorlagen sind durch die Datenbank geschützt."
            />
          </div>
        ))}
      </section>
    </div>
  );
}
