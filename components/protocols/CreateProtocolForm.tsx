// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
import type { ProtocolState } from "@/app/intern/protokolle/actions";

export function CreateProtocolForm({ action, date, templates, defaultTemplateId }: { action: (state: ProtocolState, formData: FormData) => Promise<ProtocolState>; date: string; templates: { id: number; name: string }[]; defaultTemplateId: number | null }) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  const [selectedDate, setSelectedDate] = useState(date);
  return (
    <form action={formAction} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <label className="label">Sitzungsdatum</label>
        <DatePicker portal name="date" ariaLabel="Sitzungsdatum" value={selectedDate} onChange={setSelectedDate} />
      </div>
      <div>
        <label className="label">Protokollvorlage</label>
        <Select portal name="templateId" ariaLabel="Protokollvorlage" defaultValue={String(defaultTemplateId ?? "custom")} options={[{ value: "custom", label: "Eigene Vorlage dieses Bereichs" }, ...templates.map(template => ({ value: String(template.id), label: template.name }))]} />
      </div>
      <button type="submit" disabled={pending || !selectedDate} className="btn-primary">Protokoll anlegen</button>
      {(state.error || state.success) && <p className={`sm:col-span-3 text-sm ${state.error ? "text-red-600" : "text-green-700"}`}>{state.error ?? state.success}</p>}
    </form>
  );
}
