// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useRef } from "react";
import { createLocationAction, createFinanceLocationAction, type State } from "@/app/admin/standorte/actions";

export function CreateLocationForm({module="locations"}:{module?:"locations"|"finance"}) {
  const [state, action, pending] = useActionState(
    module==="finance"?createFinanceLocationAction:createLocationAction,
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
        <label htmlFor={`new-${module}-location`} className="label">Neuer Standort</label>
        <input id={`new-${module}-location`} name="name" className="input" placeholder="Standort-Name" required />
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
