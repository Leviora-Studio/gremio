// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import type { ProtocolState } from "@/app/intern/protokolle/actions";

export function CreateProtocolForm({ action, date, templates, defaultTemplateId }: { action: (state: ProtocolState, formData: FormData) => Promise<ProtocolState>; date: string; templates: { id: number; name: string }[]; defaultTemplateId: number }) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  return (
    <form action={formAction} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <label className="label">Sitzungsdatum</label>
        <input type="date" name="date" required defaultValue={date} className="input" />
      </div>
      <div>
        <label className="label">Protokollvorlage</label>
        <select name="templateId" defaultValue={defaultTemplateId} className="input">
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-primary">Protokoll anlegen</button>
      {(state.error || state.success) && <p className={`sm:col-span-3 text-sm ${state.error ? "text-red-600" : "text-green-700"}`}>{state.error ?? state.success}</p>}
    </form>
  );
}
