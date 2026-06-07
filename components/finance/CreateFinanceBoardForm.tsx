// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Select } from "@/components/Select";
import { createFinanceBoardAction, type State } from "@/app/finanzen/actions";

export function CreateFinanceBoardForm({
  templates,
}: {
  templates: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    createFinanceBoardAction,
    {} as State,
  );

  return (
    <form action={action} noValidate className="card max-w-lg space-y-4 p-6">
      <div>
        <label htmlFor="fb-name" className="label">
          Name
        </label>
        <input id="fb-name" name="name" className="input" required autoFocus />
      </div>
      <div>
        <label htmlFor="fb-desc" className="label">
          Beschreibung (optional)
        </label>
        <textarea id="fb-desc" name="description" className="input" rows={3} />
      </div>

      <div>
        <label className="label">Finanz-Template (Haushaltsplan-Vorlage)</label>
        {templates.length > 0 ? (
          <Select
            name="templateId"
            options={[
              { value: "", label: "— kein Template —" },
              ...templates.map((t) => ({
                value: String(t.id),
                label: t.name,
              })),
            ]}
          />
        ) : (
          <p className="text-sm text-amber-700">
            Noch keine Finanz-Templates vorhanden — die Übersicht wird ohne
            vorausgefüllten Haushaltsplan erstellt. Templates verwaltet der Admin
            unter{" "}
            <Link
              href="/vorlagen/finanzen"
              className="text-brand-600 underline"
            >
              Admin → Finanz-Templates
            </Link>
            .
          </p>
        )}
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        Finanzübersicht erstellen
      </button>
      <p className="text-xs text-slate-500">
        Der Haushaltsplan kommt aus dem gewählten Template. Du bist Eigentümer und
        kannst danach alles in den Einstellungen anpassen.
      </p>
    </form>
  );
}
