// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { Select } from "@/components/Select";
import type { BudgetTitleOption } from "@/lib/budget-title-catalog";
export function BudgetTitleSelect({ value, onChange, options, preservedValue, disabled, ariaLabel = "Haushaltstitel" }: {
  value: string; onChange: (value: string) => void; options: BudgetTitleOption[];
  preservedValue?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const legacy = !!value && value === preservedValue && !options.some(option => option.value === value);
  return <div className="space-y-1">
    <Select portal searchable ariaLabel={ariaLabel} searchPlaceholder="Titelnummer oder Bezeichnung suchen …" value={value} disabled={disabled || !options.length} onChange={onChange}
      options={[{ value: "", label: "Haushaltstitel auswählen" }, ...(legacy ? [{ value, label: `${value} — Gespeicherter Titel` }] : []), ...options]}/>
    {legacy && <p className="text-xs text-slate-500">Der gespeicherte Titel bleibt erhalten; er steht nicht im aktuellen Haushaltsplan.</p>}
    {!options.length && <p className="text-xs text-amber-800">Keine Haushaltstitel verfügbar. Bitte die Finanzboard-Zuordnung und dessen Ausgaben im Haushaltsplan prüfen.</p>}
  </div>;
}
