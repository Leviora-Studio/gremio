// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { renameFinanceBoardAction, type State } from "@/app/finanzen/actions";

export function RenameFinanceForm({
  id,
  name,
  description,
}: {
  id: number;
  name: string;
  description: string | null;
}) {
  const [state, action, pending] = useActionState(
    renameFinanceBoardAction.bind(null, id),
    {} as State,
  );
  return (
    <form action={action} noValidate className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input name="name" defaultValue={name} className="input" required />
      </div>
      <div>
        <label className="label">Beschreibung</label>
        <textarea
          name="description"
          defaultValue={description ?? ""}
          className="input"
          rows={2}
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          Speichern
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.success && (
          <span className="text-sm text-green-600">{state.success}</span>
        )}
      </div>
    </form>
  );
}
