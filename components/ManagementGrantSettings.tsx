// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useActionState, useId } from "react";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";

export type ManagementPerson = { id: number; username: string; name: string | null };
export type ManagementState = { error?: string; success?: string };
export function ManagementGrantSettings({ action: save, description, candidates, managers, protectedDescription = "Die Vergabe und alle übrigen Verwaltungseinstellungen bleiben Eigentümern und Admins vorbehalten." }: {
  action: (previous: ManagementState, form: FormData) => Promise<ManagementState>;
  description: string; candidates: ManagementPerson[]; managers: (ManagementPerson & { active: boolean })[];
  protectedDescription?: string;
}) {
  const [state, action] = useActionState(save, {});
  const selectorId = useId();
  const available = candidates.filter(person => !managers.some(manager => manager.id === person.id));
  const label = (person: ManagementPerson) => person.name ? `${person.name} (${person.username})` : person.username;
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">{description}</p>
    <p className="text-sm text-slate-500">Auswählbar sind Personen mit schreibendem Zugriff, auch über Gruppen. Ohne aktuellen Schreibzugriff ruhen die Verwaltungsrechte; bei erneutem Schreibzugriff gelten sie wieder. {protectedDescription}</p>
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="operation" value="add" />
      <div className="min-w-0 flex-1"><label className="label" htmlFor={selectorId}>Person mit Schreibzugriff</label>
        <Select key={available.map(person => person.id).join(",")} id={selectorId} name="userId" searchable searchPlaceholder="Person suchen…" placeholder="Person auswählen…" options={available.map(person => ({ value: String(person.id), label: label(person) }))} disabled={!available.length} />
      </div>
      <SubmitButton className="btn-primary" disabled={!available.length}>Verwaltungsrechte vergeben</SubmitButton>
    </form>
    {!available.length && <p className="text-sm text-slate-500">Keine weiteren Personen mit Schreibzugriff verfügbar.</p>}
    {managers.length > 0 && <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {managers.map(person => <li key={person.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 break-words text-sm sm:w-auto sm:flex-1"><span className="font-medium">{label(person)}</span>{!person.active && <p className="mt-1 text-amber-700">Derzeit ohne Verwaltungszugriff (Schreibzugriff fehlt oder Konto deaktiviert).</p>}</div>
        <form action={action} className="w-full sm:w-auto"><input type="hidden" name="operation" value="remove" /><input type="hidden" name="userId" value={person.id} /><SubmitButton className="btn-secondary btn-sm w-full sm:w-auto">Verwaltungsrechte entziehen</SubmitButton></form>
      </li>)}
    </ul>}
    {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    {state.success && <p role="status" className="text-sm text-emerald-700">{state.success}</p>}
  </div>;
}
