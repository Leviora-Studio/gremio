// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";

type State = { error?: string; success?: string };

/**
 * Nextcloud-Archiv-Trigger: bis zu ZWEI auslösende Spalten (beide optional).
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
  const [a, setA] = useState(initial[0] ? String(initial[0]) : "");
  const [b, setB] = useState(initial[1] ? String(initial[1]) : "");
  const options = [
    { value: "", label: "— keine —" },
    ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Auslösende Spalte</label>
          <Select name="statusId" className="w-64" value={a} onChange={setA} options={options} />
        </div>
        <div>
          <label className="label">Zweite Spalte (optional)</label>
          <Select name="statusId2" className="w-64" value={b} onChange={setB} options={options} />
        </div>
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
