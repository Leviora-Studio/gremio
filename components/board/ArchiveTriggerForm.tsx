// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";

type State = { error?: string; success?: string };

/**
 * An arbitrary set of triggering columns; an empty selection disables it.
 * `action` ist bereits an die Board-ID gebunden: (prev, formData) => State.
 */
export function ArchiveTriggerForm({
  action,
  statuses,
  initial,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  statuses: { id: number; name: string }[];
  initial: number[];
}) {
  const [state, formAction, pending] = useActionState(action, {} as State);
  const [selected, setSelected] = useState(initial);

  return (
    <div>
      <form action={formAction} className="space-y-3">
        <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-2">
          <legend className="label">Auslösende Spalten</legend>
          {statuses.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="statusIds" value={s.id} checked={selected.includes(s.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id))} className="rounded text-brand-600" />{s.name}
          </label>)}
        </fieldset>
        <p className="text-xs text-slate-500">Keine Auswahl deaktiviert den Trigger.</p>
        <button type="submit" disabled={pending} className="btn-secondary">
          Setzen
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="mt-2 text-sm text-green-600">{state.success}</p>
      )}
    </div>
  );
}
