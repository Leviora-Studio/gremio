// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  activateLoanTrackingAction,
  deactivateLoanTrackingAction,
  type LoanBoardState,
} from "@/app/intern/inventar/[id]/einstellungen/actions";

/**
 * Aufgabentracking aktivieren/deaktivieren. Bei Aktivierung wird ein dediziertes
 * Leihvorgang-Board (System-Board) angelegt — kein Auswählen bestehender Boards.
 */
export function LoanBoardEditor({
  boardId,
  loanBoard,
  suggestedName,
}: {
  boardId: number;
  loanBoard: { id: number; name: string } | null;
  suggestedName: string;
}) {
  const [state, action, pending] = useActionState(
    activateLoanTrackingAction.bind(null, boardId),
    {} as LoanBoardState,
  );

  if (loanBoard) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Aufgabentracking ist aktiv. Jeder Entleihvorgang wird zu einer Karte
          auf diesem Board; der Antragsteller sieht dessen Spalten als Status.
          Ein Klick auf eine Karte öffnet die Leih-Detailansicht (Vertrag,
          Hinweise …).
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3">
          <span className="text-sm">
            <span className="font-medium text-slate-800">{loanBoard.name}</span>
            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
              aktiv
            </span>
          </span>
          <Link
            href={`/intern/board/${loanBoard.id}`}
            className="btn-secondary ml-auto"
          >
            Board öffnen →
          </Link>
          <ConfirmButton
            action={deactivateLoanTrackingAction.bind(null, boardId)}
            className="btn-secondary text-red-600"
            label="Entfernen"
            title="Leihvorgang-Board entfernen?"
            message="Das Board und alle darauf liegenden Vorgangs-Karten werden gelöscht. Die Vorgänge selbst bleiben erhalten, verlieren aber ihre Karte."
            confirmLabel="Entfernen"
            confirmClassName="btn-danger"
          />
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-slate-500">
        Aktiviere das Aufgabentracking: Es wird automatisch ein eigenes
        Kanban-Board für die Leihvorgänge angelegt. Zugriff/Freigaben
        entsprechen dem Inventar; die Vorgangs-Karten öffnen die
        Leih-Detailansicht.
      </p>
      <div>
        <label htmlFor="lb-name" className="label">
          Name des Leihvorgang-Boards
        </label>
        <input
          id="lb-name"
          name="boardName"
          className="input sm:w-96"
          defaultValue={suggestedName}
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          Aufgabentracking aktivieren
        </button>
        {state.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
        {state.success && (
          <span className="text-sm text-green-600">{state.success}</span>
        )}
      </div>
    </form>
  );
}
