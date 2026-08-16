// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { PRIORITY_COLOR_OPTIONS, priorityBadgeClass } from "@/lib/constants";
import {
  createPriorityAction,
  type State,
} from "@/app/admin/priorities/actions";

const DEFAULT_COLOR = PRIORITY_COLOR_OPTIONS[0].value;

export function CreatePriorityForm() {
  const [state, action, pending] = useActionState(
    createPriorityAction,
    {} as State,
  );
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);

  useEffect(() => {
    if (state.success) {
      setLabel("");
      setColor(DEFAULT_COLOR);
    }
  }, [state.success]);

  return (
    <form
      action={action}
      noValidate
      className="card flex flex-wrap items-end gap-3 p-4"
    >
      <div className="w-20">
        <label className="label">Vorschau</label>
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(
            color,
          )}`}
        >
          {label || "—"}
        </span>
      </div>
      <div>
        <label className="label">Neue Priorität</label>
        <input
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="input w-48"
          placeholder="Bezeichnung"
          required
        />
      </div>
      <div className="w-40">
        <label className="label">Farbe</label>
        <Select
          name="color"
          value={color}
          onChange={setColor}
          options={PRIORITY_COLOR_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-32">
        Anlegen
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
