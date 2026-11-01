// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { UserMultiTypeahead } from "@/components/antrag/UserMultiTypeahead";
import { useRetainedForm } from "@/components/useRetainedForm";

type State = { error?: string; success?: string };
type U = { id: number; username: string; name?: string | null; avatarPath?: string | null };

/**
 * Zuweisungs-Aktionen eines Board-Triggers: optional alle Zuweisungen entfernen,
 * danach die gewählten Nutzer zusätzlich zuweisen. Beides leer = keine Aktion.
 * `action` ist bereits an Board-ID und Trigger gebunden: (prev, formData) => State.
 */
export function TriggerAssignmentForm({
  action,
  boardId,
  when,
  initialClear,
  initialUsers,
  assigneeVisible,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  boardId: number;
  when: string;
  initialClear: boolean;
  initialUsers: U[];
  assigneeVisible: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as State);
  const [clear, setClear] = useState(initialClear);
  const [selected, setSelected] = useState<U[]>(initialUsers);
  const formRef = useRetainedForm();

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <form ref={formRef} action={formAction} className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">
          Zuweisungen beim Auslösen
        </p>
        <p className="text-xs text-slate-500">{when}</p>
        {!assigneeVisible && (
          <p className="text-xs text-amber-700">
            Das Kartenfeld „Zugewiesen zu“ ist an diesem Board ausgeblendet. Die
            Aktionen greifen erst, wenn es unter „Kartenfelder“ aktiviert ist.
          </p>
        )}
        <fieldset disabled={pending} className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="clearAssignees"
              checked={clear}
              onChange={(e) => setClear(e.target.checked)}
              className="rounded text-brand-600"
            />
            Alle Zuweisungen entfernen
          </label>
          <div>
            <label className="label">Zusätzlich zuweisen zu</label>
            <UserMultiTypeahead
              boardId={boardId}
              initial={initialUsers}
              onChange={setSelected}
            />
            {selected.map((u) => (
              <input key={u.id} type="hidden" name="userIds" value={u.id} />
            ))}
            <p className="mt-1 text-xs text-slate-500">
              Ohne Auswahl wird niemand zusätzlich zugewiesen.
            </p>
          </div>
        </fieldset>
        <button type="submit" disabled={pending} className="btn-secondary">
          Speichern
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="mt-2 text-sm text-green-600">{state.success}</p>
      )}
    </div>
  );
}
