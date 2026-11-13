// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import { renameBoardAction, type State } from "@/app/intern/board/[id]/einstellungen/actions";

export function RenameBoardForm({
  boardId,
  name,
  description,
  isApplicationBoard,
}: {
  boardId: number;
  name: string;
  description: string | null;
  isApplicationBoard: boolean;
}) {
  const [state, action, pending] = useActionState(
    renameBoardAction.bind(null, boardId),
    {} as State,
  );
  return (
    <form action={action} onReset={event => event.preventDefault()} noValidate className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input name="name" defaultValue={name} className="input" required />
      </div>
      <div>
        <label className="label">Beschreibung</label>
        <textarea
          name="description"
          defaultValue={description ?? ""}
          className="input"
          rows={2}
        />
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="isApplicationBoard" defaultChecked={isApplicationBoard} className="mt-1" />
          <span>Antragsboard: Haushaltstitel auf Karten einplanen</span>
        </label>
        <p className="mt-1 text-xs text-slate-500">Erfasst Beträge und Haushaltstitel für Beschlussvorschläge. Bestehende Finanzbeträge bleiben unabhängig davon. Beim Deaktivieren bleiben Einplanungen erhalten.</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {"Speichern"}
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.success && (
          <span className="text-sm text-green-600">{state.success}</span>
        )}
      </div>
    </form>
  );
}
