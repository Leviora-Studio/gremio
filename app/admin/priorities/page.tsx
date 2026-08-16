// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { requireAdmin } from "@/lib/auth";
import { getPriorities } from "@/lib/priorities";
import { CreatePriorityForm } from "@/components/admin/CreatePriorityForm";
import { PriorityRow } from "@/components/admin/PriorityRow";

export default async function PrioritiesPage() {
  await requireAdmin();
  const items = await getPriorities();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Prioritäten</h2>
        <p className="text-sm text-slate-500">
          Auswahloptionen für das Kartenfeld „Priorität". Frei anlegbar — Anzahl,
          Bezeichnung und Farbe bestimmst du selbst. Sie erscheinen auf den Karten
          als Auswahlfeld (sofern das Feld am Board aktiviert ist).
        </p>
      </div>

      <CreatePriorityForm />

      {items.length === 0 && (
        <p className="text-sm text-slate-500">Noch keine Prioritäten angelegt.</p>
      )}
      {items.map((p) => (
        <PriorityRow key={p.id} priority={p} />
      ))}
    </div>
  );
}
