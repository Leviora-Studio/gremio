// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import {
  setDoneColumnAction,
  type State,
} from "@/app/intern/board/[id]/einstellungen/actions";

export function DoneColumnForm({
  boardId,
  statuses,
  config,
}: {
  boardId: number;
  statuses: { id: number; name: string }[];
  config: { doneStatusId: number | null; doneSweepTime: string | null };
}) {
  const [enabled, setEnabled] = useState(config.doneStatusId != null);
  const [state, action, pending] = useActionState(
    setDoneColumnAction.bind(null, boardId),
    {} as State,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Markiere eine Spalte als „Done". Karten in dieser Spalte werden täglich
        zur gewählten Uhrzeit automatisch <strong>archiviert</strong> (ausgeblendet,
        nicht gelöscht) — jede erledigte Karte bleibt also bis zum nächsten
        Tageswechsel sichtbar. Archivierte Karten findest du im{" "}
        <strong>Archiv</strong> des Boards und kannst sie von dort zurückholen.
      </p>

      <form action={action} className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Done-Spalte aktivieren
        </label>

        {enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Done-Spalte</label>
              <Select
                name="statusId"
                defaultValue={
                  config.doneStatusId ? String(config.doneStatusId) : ""
                }
                placeholder="— Spalte wählen —"
                options={[
                  { value: "", label: "— Spalte wählen —" },
                  ...statuses.map((s) => ({
                    value: String(s.id),
                    label: s.name,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="label">Archivieren täglich um</label>
              <input
                type="time"
                name="time"
                className="input"
                defaultValue={config.doneSweepTime ?? "03:00"}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">
            Speichern
          </button>
          {state.error && <span className="text-sm text-red-600">{state.error}</span>}
          {state.success && (
            <span className="text-sm text-green-600">{state.success}</span>
          )}
        </div>
      </form>
    </div>
  );
}
