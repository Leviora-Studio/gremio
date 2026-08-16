// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Select } from "@/components/Select";
import { createBoardAction, type State } from "@/app/intern/board/actions";

export function CreateBoardForm({
  templates,
}: {
  templates: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    createBoardAction,
    {} as State,
  );

  return (
    <form action={action} noValidate className="card max-w-lg space-y-4 p-6">
      <div>
        <label htmlFor="b-name" className="label">
          Board-Name
        </label>
        <input id="b-name" name="name" className="input" required autoFocus />
      </div>
      <div>
        <label htmlFor="b-desc" className="label">
          Beschreibung (optional)
        </label>
        <textarea id="b-desc" name="description" className="input" rows={3} />
      </div>

      <div>
        <label className="label">Template (Spalten-Vorlage)</label>
        {templates.length > 0 ? (
          <Select
            name="templateId"
            defaultValue={String(templates[0].id)}
            options={templates.map((t) => ({
              value: String(t.id),
              label: t.name,
            }))}
          />
        ) : (
          <p className="text-sm text-amber-700">
            Noch keine Templates vorhanden — das Board wird ohne Spalten
            erstellt. Templates verwaltet der Admin unter{" "}
            <Link href="/vorlagen/boards" className="text-brand-600 underline">
              Admin → Templates
            </Link>
            .
          </p>
        )}
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        Board erstellen
      </button>
      <p className="text-xs text-slate-500">
        Die Spalten kommen aus dem gewählten Template. Du bist Eigentümer und
        kannst danach alles in den Board-Einstellungen anpassen.
      </p>
    </form>
  );
}
