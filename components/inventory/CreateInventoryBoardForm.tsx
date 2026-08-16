// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import {
  createInventoryBoardAction,
  type State,
} from "@/app/intern/inventar/actions";

export function CreateInventoryBoardForm() {
  const [state, action, pending] = useActionState(
    createInventoryBoardAction,
    {} as State,
  );

  return (
    <form action={action} noValidate className="card max-w-lg space-y-4 p-6">
      <div>
        <label htmlFor="inv-name" className="label">
          Name des Inventars
        </label>
        <input
          id="inv-name"
          name="name"
          className="input"
          required
          autoFocus
          placeholder="z. B. StuRa Köthen"
        />
      </div>
      <div>
        <label htmlFor="inv-desc" className="label">
          Beschreibung (optional)
        </label>
        <textarea id="inv-desc" name="description" className="input" rows={3} />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        Inventar erstellen
      </button>
      <p className="text-xs text-slate-500">
        Du bist Eigentümer und kannst danach Felder, Nummerierung und Freigaben
        in den Einstellungen anpassen.
      </p>
    </form>
  );
}
