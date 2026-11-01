// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/Select";
import { useRetainedForm } from "@/components/useRetainedForm";
import { saveOfficeRoleAction } from "@/app/intern/board/[id]/einstellungen/actions";

export function OfficeRoleForm({ boardId, people, statuses, initial }: {
  boardId: number;
  people: { id: number; username: string; name: string | null }[];
  statuses: { id: number; name: string }[];
  initial: { enabled: boolean; userId: number | null; sourceStatusIds: number[]; targetStatusIds: number[] };
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [state, action, pending] = useActionState(saveOfficeRoleAction.bind(null, boardId), {});
  const formRef = useRetainedForm();
  return <form ref={formRef} action={action} className="space-y-4">
    <p className="text-sm text-slate-500">Die Bürokraft darf bei lesendem Board-Zugriff ausschließlich Karten aus den gewählten Ausgangsspalten in die gewählten Zielspalten verschieben. Karteninhalte, Kommentare und Anhänge bleiben unveränderbar. Vorhandene Schreibrechte aus direkten oder Gruppenfreigaben haben Vorrang.</p>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" checked={enabled} disabled={pending} onChange={event => setEnabled(event.target.checked)} />Bürokraft aktivieren</label>
    <div className="max-w-md"><label className="label">Person mit Board-Zugriff</label>
      <Select name="userId" ariaLabel="Bürokraft auswählen" defaultValue={initial.userId == null ? "" : String(initial.userId)} disabled={!enabled || pending} searchable placeholder="Person auswählen …"
        options={people.map(person => ({ value: String(person.id), label: person.name ? `${person.name} (${person.username})` : person.username }))} />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{(["source", "target"] as const).map(direction => <fieldset key={direction} disabled={!enabled || pending} className="space-y-2 rounded border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">{direction === "source" ? "Erlaubte Ausgangsspalten" : "Erlaubte Zielspalten"}</legend>
      {statuses.map(status => <label key={status.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={direction === "source" ? "sourceStatusIds" : "targetStatusIds"} value={status.id} defaultChecked={(direction === "source" ? initial.sourceStatusIds : initial.targetStatusIds).includes(status.id)} />{status.name}
      </label>)}
    </fieldset>)}</div>
    <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Wird gespeichert …" : "Bürokraft-Einstellung speichern"}</button>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    {state.success && <p role="status" className="text-sm text-green-700">{state.success}</p>}
  </form>;
}
