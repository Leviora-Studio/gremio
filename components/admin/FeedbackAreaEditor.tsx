// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RenameWithConfirm } from "@/components/admin/RenameWithConfirm";
import {
  deleteFeedbackAreaAction,
  renameFeedbackAreaAction,
  setFeedbackAreaTargetAction,
  toggleFeedbackAreaEnabledAction,
  type State,
} from "@/app/admin/umfragen/actions";

type BoardWithStatuses = {
  id: number;
  name: string;
  statuses: { id: number; name: string }[];
};

type AreaLite = {
  id: number;
  name: string;
  enabled: boolean;
  targetBoardId: number | null;
  targetStatusId: number | null;
};

/** Ein Feedback-Bereich — Bedienung wie der Standort-Editor der Anträge. */
export function FeedbackAreaEditor({
  area,
  boards,
}: {
  area: AreaLite;
  boards: BoardWithStatuses[];
}) {
  // Beide Felder als kontrollierter lokaler State — die Anzeige spiegelt immer
  // die zuletzt getroffene Auswahl wider (unabhängig von Revalidation-Timing).
  const [boardId, setBoardId] = useState(
    area.targetBoardId ? String(area.targetBoardId) : "",
  );
  const [statusId, setStatusId] = useState(
    area.targetStatusId ? String(area.targetStatusId) : "",
  );

  const [targetState, targetAction, targetPending] = useActionState(
    setFeedbackAreaTargetAction.bind(null, area.id),
    {} as State,
  );
  const selectedBoard = boards.find((b) => String(b.id) === boardId);
  const statuses = selectedBoard?.statuses ?? [];

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <RenameWithConfirm
          currentName={area.name}
          action={renameFeedbackAreaAction.bind(null, area.id)}
          entityLabel="Bereich"
          inputClassName="input w-48"
        />
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              area.enabled
                ? "bg-green-100 text-green-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {area.enabled ? "aktiv" : "inaktiv"}
          </span>
          <DeleteConfirm
            action={deleteFeedbackAreaAction.bind(null, area.id)}
            compact
            buttonLabel="Löschen"
            buttonClassName="btn-danger btn-sm"
            title={`Bereich „${area.name}" löschen`}
            message="Der Bereich wird gelöscht; bereits eingereichtes Feedback bleibt erhalten und behält seinen Bereichsnamen."
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
          action={toggleFeedbackAreaEnabledAction.bind(null, area.id)}
          className="btn-secondary"
          label={area.enabled ? "Deaktivieren" : "Aktivieren"}
          title={`Bereich „${area.name}" ${
            area.enabled ? "deaktivieren" : "aktivieren"
          }`}
          message={
            area.enabled
              ? "Der Bereich verschwindet aus dem öffentlichen Feedback-Formular — es kann kein neues Feedback mehr darüber eingereicht werden."
              : "Der Bereich erscheint im öffentlichen Feedback-Formular (Ziel-Board und Spalte müssen gesetzt sein)."
          }
          confirmLabel={area.enabled ? "Deaktivieren" : "Aktivieren"}
          confirmClassName={area.enabled ? "btn-danger" : "btn-primary"}
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
