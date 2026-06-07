// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { renameTemplateAction, type State } from "@/app/vorlagen/boards/actions";

export function RenameTemplateForm({
  templateId,
  name,
  description,
}: {
  templateId: number;
  name: string;
  description: string | null;
}) {
  const [state, action, pending] = useActionState(
    renameTemplateAction.bind(null, templateId),
    {} as State,
  );
  return (
    <form
      action={action}
      noValidate
      className="card grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
    >
      <div>
        <label className="label">Name</label>
        <input name="name" defaultValue={name} className="input" required />
      </div>
      <div>
        <label className="label">Beschreibung</label>
        <input name="description" defaultValue={description ?? ""} className="input" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {"Speichern"}
      </button>
      {(state.error || state.success) && (
        <p
          className={`text-sm sm:col-span-3 ${
            state.error ? "text-red-600" : "text-green-600"
          }`}
        >
          {state.error ?? state.success}
        </p>
      )}
    </form>
  );
}
