// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RenameWithConfirm } from "@/components/admin/RenameWithConfirm";
import {
  deleteLocationAction,
  renameLocationAction,
  setLocationTargetAction,
  toggleLocationEnabledAction,
  type State,
} from "@/app/admin/standorte/actions";

type BoardWithStatuses = {
  id: number;
  name: string;
  statuses: { id: number; name: string }[];
};

type LocationLite = {
  id: number;
  name: string;
  enabled: boolean;
  targetBoardId: number | null;
  targetStatusId: number | null;
};

export function LocationEditor({
  location,
  boards,
}: {
  location: LocationLite;
  boards: BoardWithStatuses[];
}) {
  // Beide Felder als kontrollierter lokaler State — die Anzeige spiegelt immer
  // die zuletzt getroffene Auswahl wider (unabhängig von Revalidation-Timing).
  const [boardId, setBoardId] = useState(
    location.targetBoardId ? String(location.targetBoardId) : "",
  );
  const [statusId, setStatusId] = useState(
    location.targetStatusId ? String(location.targetStatusId) : "",
  );

  const [targetState, targetAction, targetPending] = useActionState(
    setLocationTargetAction.bind(null, location.id),
    {} as State,
  );
  const selectedBoard = boards.find((b) => String(b.id) === boardId);
  const statuses = selectedBoard?.statuses ?? [];

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <RenameWithConfirm
          currentName={location.name}
          action={renameLocationAction.bind(null, location.id)}
          entityLabel="Standort"
          inputClassName="input w-48"
        />
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              location.enabled
                ? "bg-green-100 text-green-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {location.enabled ? "aktiv" : "inaktiv"}
          </span>
          <DeleteConfirm
            action={deleteLocationAction.bind(null, location.id)}
            compact
            buttonLabel="Löschen"
            buttonClassName="btn-danger btn-sm"
            title={`Standort „${location.name}" löschen`}
            message="Der Standort wird gelöscht; Karten, die von dort kamen, bleiben erhalten."
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <form action={targetAction} className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <label className="label">Ziel-Board</label>
            <Select
              name="boardId"
              value={boardId}
              onChange={(v) => {
                setBoardId(v);
                setStatusId(""); // Spalte zurücksetzen, wenn Board wechselt
              }}
              placeholder="— kein Ziel —"
              options={[
                { value: "", label: "— kein Ziel —" },
                ...boards.map((b) => ({ value: String(b.id), label: b.name })),
              ]}
            />
          </div>
          <div className="w-56">
            <label className="label">Ziel-Spalte</label>
            <Select
              name="statusId"
              value={statusId}
              onChange={setStatusId}
              disabled={!boardId}
              placeholder="— Spalte wählen —"
              options={[
                { value: "", label: "— Spalte wählen —" },
                ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </div>
          <button type="submit" disabled={targetPending} className="btn-primary">
            {"Ziel speichern"}
          </button>
        </form>
        <ConfirmButton
          action={toggleLocationEnabledAction.bind(null, location.id)}
          className="btn-secondary"
          label={location.enabled ? "Deaktivieren" : "Aktivieren"}
          title={`Standort „${location.name}" ${
            location.enabled ? "deaktivieren" : "aktivieren"
          }`}
          message={
            location.enabled
              ? "Der Standort verschwindet aus dem öffentlichen Formular — es können keine neuen Anträge mehr darüber eingereicht werden."
              : "Der Standort erscheint im öffentlichen Formular und kann Anträge empfangen (Ziel-Board und Spalte müssen gesetzt sein)."
          }
          confirmLabel={location.enabled ? "Deaktivieren" : "Aktivieren"}
          confirmClassName={location.enabled ? "btn-danger" : "btn-primary"}
        />
      </div>

      {(targetState.error || targetState.success) && (
        <p
          className={`mt-2 text-sm ${
            targetState.error ? "text-red-600" : "text-green-600"
          }`}
        >
          {targetState.error ?? targetState.success}
        </p>
      )}
    </div>
  );
}
