// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createFeedbackAreaAction,
  type State,
} from "@/app/admin/umfragen/actions";

export function CreateFeedbackAreaForm() {
  const [state, action, pending] = useActionState(
    createFeedbackAreaAction,
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
        <label className="label">Neuer Bereich</label>
        <input
          name="name"
          className="input"
          placeholder="z. B. Bibliothek"
          maxLength={80}
          required
        />
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
