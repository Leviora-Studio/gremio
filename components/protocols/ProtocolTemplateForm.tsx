// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import type { State } from "@/app/vorlagen/protokolle/actions";

export function ProtocolTemplateForm({
  action,
  initial,
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  initial?: { name: string; description: string | null; markdown: string };
}) {
  const [state, formAction, pending] = useActionState(action, {} as State);
  return (
    <form action={formAction} className="card space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" required defaultValue={initial?.name} />
        </div>
        <div>
          <label className="label">Beschreibung (optional)</label>
          <input name="description" className="input" defaultValue={initial?.description ?? ""} />
        </div>
      </div>
      <div>
        <label className="label">Markdown-Inhalt</label>
        <textarea
          name="markdown"
          className="input min-h-64 font-mono text-sm"
          required
          defaultValue={initial?.markdown ?? "# Sitzung {{session.date_de}}\n\n## Anwesenheit\n\n### Mitglieder\n\n### Gäste\n\n## Tagesordnung"}
        />
        <p className="mt-1 text-xs text-slate-500">
          Variablen: {"{{session.date}}"}, {"{{session.date_de}}"}, {"{{session.folder_name}}"}, {"{{protocol_area.name}}"}, {"{{created_at}}"}
        </p>
      </div>
      {(state.error || state.success) && (
        <p className={`text-sm ${state.error ? "text-red-600" : "text-green-700"}`}>
          {state.error ?? state.success}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {initial ? "Speichern" : "Vorlage anlegen"}
      </button>
    </form>
  );
}
