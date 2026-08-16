// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/Select";
import { setCardStatusAction } from "@/app/intern/card/[id]/actions";

/**
 * Spalte (Status) der verknüpften Kanban-Karte eines Leihvorgangs direkt per
 * Auswahl ändern — analog zum StatusSelect auf normalen Boards, nur dass hier
 * nach dem Speichern die Leihansicht neu geladen wird (Stufen-Badge/„Aktuelle
 * Spalte" leiten sich daraus ab). Der Spaltenwechsel triggert serverseitig den
 * Leih-Sync (ausgeliehen/zurückgegeben) über setCardStatusAction.
 */
export function LoanColumnSelect({
  cardId,
  columns,
  current,
}: {
  cardId: number;
  columns: { id: number; name: string }[];
  current: number;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-full sm:w-56"
        defaultValue={String(current)}
        disabled={saving}
        options={columns.map((c) => ({ value: String(c.id), label: c.name }))}
        onChange={async (v) => {
          if (Number(v) === current) return;
          setSaving(true);
          await setCardStatusAction(cardId, Number(v));
          router.refresh();
          setSaving(false);
        }}
      />
      {saving && <span className="text-xs text-slate-400">…</span>}
    </div>
  );
}
