// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import {
  setLoanBoardTargetAction,
  type LoanBoardState,
} from "@/app/intern/inventar/[id]/einstellungen/actions";

type BoardWithStatuses = {
  id: number;
  name: string;
  statuses: { id: number; name: string }[];
};

/**
 * Ziel-Board für Leihvorgänge (Aufgabentracking) wählen: Jeder Vorgang wird zu
 * einer Karte auf diesem Board. Optional zwei Trigger-Spalten — erreicht die
 * Karte sie, gilt der Gegenstand als ausgeliehen bzw. zurückgegeben.
 */
export function LoanBoardEditor({
  boardId,
  current,
  boards,
}: {
  boardId: number;
  current: {
    loanBoardId: number | null;
    loanActiveStatusId: number | null;
    loanReturnedStatusId: number | null;
  };
  boards: BoardWithStatuses[];
}) {
  const [loanBoardId, setLoanBoardId] = useState(
    current.loanBoardId ? String(current.loanBoardId) : "",
  );
  const [activeId, setActiveId] = useState(
    current.loanActiveStatusId ? String(current.loanActiveStatusId) : "",
  );
  const [returnedId, setReturnedId] = useState(
    current.loanReturnedStatusId ? String(current.loanReturnedStatusId) : "",
  );
  const [state, action, pending] = useActionState(
    setLoanBoardTargetAction.bind(null, boardId),
    {} as LoanBoardState,
  );

  const selectedBoard = boards.find((b) => String(b.id) === loanBoardId);
  const statuses = selectedBoard?.statuses ?? [];
  const colOptions = (empty: string) => [
    { value: "", label: empty },
    ...statuses.map((s) => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-500">
        Jeder Entleihvorgang wird automatisch zu einer Karte auf dem gewählten
        Board. Der Antragsteller sieht dessen Spalten als Status. Erreicht die
        Karte die Trigger-Spalten, gilt der Gegenstand als ausgeliehen bzw.
        wieder verfügbar.
      </p>

      <div>
        <label className="label">Ziel-Board für Leihvorgänge</label>
        <Select
          name="loanBoardId"
          className="sm:w-80"
          searchable={boards.length > 8}
          value={loanBoardId}
          onChange={(v) => {
            setLoanBoardId(v);
            setActiveId("");
            setReturnedId("");
          }}
          placeholder="— kein Aufgabentracking —"
          options={[
            { value: "", label: "— kein Aufgabentracking —" },
            ...boards.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
      </div>

      {loanBoardId && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Spalte „ausgeliehen"</label>
            <Select
              name="loanActiveStatusId"
              value={activeId}
              onChange={setActiveId}
              placeholder="— optional —"
              options={colOptions("— optional —")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Ab dieser Spalte gilt der Gegenstand als entliehen.
            </p>
          </div>
          <div>
            <label className="label">Spalte „zurückgegeben"</label>
            <Select
              name="loanReturnedStatusId"
              value={returnedId}
              onChange={setReturnedId}
              placeholder="— optional —"
              options={colOptions("— optional —")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Ab dieser Spalte ist der Gegenstand wieder verfügbar.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          Speichern
        </button>
        {(state.error || state.success) && (
          <span
            className={`text-sm ${
              state.error ? "text-red-600" : "text-green-600"
            }`}
          >
            {state.error ?? state.success}
          </span>
        )}
      </div>
    </form>
  );
}
