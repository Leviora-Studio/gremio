// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { createGroupAction, type State } from "@/app/admin/groups/actions";

const initial: State = {};

export function CreateGroupForm() {
  const [state, action, pending] = useActionState(createGroupAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form
      ref={ref}
      action={action}
      noValidate
      className="card grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
    >
      <div>
        <label htmlFor="g-name" className="label">
          Gruppenname
        </label>
        <input id="g-name" name="name" className="input" required />
      </div>
      <div>
        <label htmlFor="g-desc" className="label">
          Beschreibung (optional)
        </label>
        <input id="g-desc" name="description" className="input" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {"Anlegen"}
      </button>
      {(state.error || state.success) && (
        <p
          className={`sm:col-span-3 text-sm ${
            state.error ? "text-red-600" : "text-green-600"
          }`}
        >
          {state.error ?? state.success}
        </p>
      )}
    </form>
  );
}
