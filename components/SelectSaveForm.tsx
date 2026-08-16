// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";

type State = { error?: string; success?: string };

/**
 * Kleines Speichern-Formular mit kontrolliertem Select + grüner Bestätigung.
 * `action` muss bereits an die ID gebunden sein: (prev, formData) => State.
 * Die Meldung steht in einer eigenen Zeile darunter, damit der Button beim
 * Speichern nicht umbricht/flackert.
 */
export function SelectSaveForm({
  action,
  name,
  label,
  options,
  initial,
  submitLabel = "Speichern",
  submitClassName = "btn-secondary",
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  name: string;
  label: string;
  options: { value: string; label: string }[];
  initial: string;
  submitLabel?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as State);
  const [value, setValue] = useState(initial);
  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">{label}</label>
          <Select
            name={name}
            className="w-64"
            value={value}
            onChange={setValue}
            options={options}
          />
        </div>
        <button type="submit" disabled={pending} className={submitClassName}>
          {submitLabel}
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="mt-2 text-sm text-green-600">{state.success}</p>
      )}
    </div>
  );
}
