// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLocationAction, type State } from "@/app/admin/standorte/actions";

export function CreateLocationForm() {
  const [state, action, pending] = useActionState(
    createLocationAction,
    {} as State,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form
      ref={ref}
      action={action}
      noValidate
      className="card flex flex-wrap items-end gap-2 p-4"
    >
      <div className="flex-1">
        <label className="label">Neuer Standort</label>
        <input name="name" className="input" placeholder="Standort-Name" required />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {"Anlegen"}
      </button>
      {(state.error || state.success) && (
        <p
          className={`w-full text-sm ${
            state.error ? "text-red-600" : "text-green-600"
          }`}
        >
          {state.error ?? state.success}
        </p>
      )}
    </form>
  );
}
