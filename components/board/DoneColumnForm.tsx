// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition } from "react";
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
  // Reiner lokaler State + imperativer Action-Aufruf (kein <form action>), damit
  // React 19 das Formular nach dem Speichern NICHT automatisch zurücksetzt —
  // sonst entkoppelt sich der kontrollierte Haken kurz (Flackern). Gleiches
  // Muster wie BoardNumberingForm.
  const [enabled, setEnabled] = useState(config.doneStatusId != null);
  const [statusId, setStatusId] = useState(
    config.doneStatusId ? String(config.doneStatusId) : "",
  );
  const [time, setTime] = useState(config.doneSweepTime ?? "03:00");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<State>({});

  function save() {
    const fd = new FormData();
    if (enabled) fd.set("enabled", "on");
    fd.set("statusId", statusId);
    fd.set("time", time);
    startTransition(async () => {
      setMsg(await setDoneColumnAction(boardId, {} as State, fd));
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Markiere eine Spalte als „Done". Karten in dieser Spalte werden täglich
        zur gewählten Uhrzeit automatisch <strong>archiviert</strong> (ausgeblendet,
        nicht gelöscht) — jede erledigte Karte bleibt also bis zum nächsten
        Tageswechsel sichtbar. Archivierte Karten findest du im{" "}
        <strong>Archiv</strong> des Boards und kannst sie von dort zurückholen.
      </p>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
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
                value={statusId}
                onChange={setStatusId}
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
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="input"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="btn-primary"
          >
            Speichern
          </button>
          {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
          {msg.success && (
            <span className="text-sm text-green-600">{msg.success}</span>
          )}
        </div>
      </div>
    </div>
  );
}
