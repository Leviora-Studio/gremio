// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { createTemplateAction, type State } from "@/app/vorlagen/boards/actions";

export function CreateTemplateForm() {
  const [state, action, pending] = useActionState(
    createTemplateAction,
    {} as State,
  );
  return (
    <form
      action={action}
      noValidate
      className="card grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
    >
      <div>
        <label className="label">Template-Name</label>
        <input name="name" className="input" required />
      </div>
      <div>
        <label className="label">Beschreibung (optional)</label>
        <input name="description" className="input" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {"Anlegen"}
      </button>
      {state.error && (
        <p className="text-sm text-red-600 sm:col-span-3">{state.error}</p>
      )}
    </form>
  );
}
