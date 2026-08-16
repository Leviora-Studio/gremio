// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { PRIORITY_COLOR_OPTIONS, priorityBadgeClass } from "@/lib/constants";
import {
  updatePriorityAction,
  deletePriorityAction,
  type State,
} from "@/app/admin/priorities/actions";

export function PriorityRow({
  priority,
}: {
  priority: { id: number; label: string; color: string };
}) {
  const [state, action] = useActionState(
    updatePriorityAction.bind(null, priority.id),
    {} as State,
  );
  const [label, setLabel] = useState(priority.label);
  const [color, setColor] = useState(priority.color);

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
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
          <label className="label">Bezeichnung</label>
          <input
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="input w-48"
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
        <SubmitButton className="btn-primary w-32">Speichern</SubmitButton>
        {(state.error || state.success) && (
          <span
            className={`text-sm ${
              state.error ? "text-red-600" : "text-green-600"
            }`}
          >
            {state.error ?? state.success}
          </span>
        )}
      </form>
      <div className="ml-auto">
        <DeleteConfirm
          action={deletePriorityAction.bind(null, priority.id)}
          compact
          buttonLabel="Löschen"
          buttonClassName="btn-danger px-3"
          title={`Priorität „${priority.label}" löschen`}
          message="Die Priorität wird gelöscht. Karten mit dieser Priorität behalten ihre übrigen Daten, das Prioritätsfeld wird dort geleert."
        />
      </div>
    </div>
  );
}
