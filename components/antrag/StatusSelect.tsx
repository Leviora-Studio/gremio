// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { setCardStatusAction } from "@/app/intern/card/[id]/actions";

export function StatusSelect({
  cardId,
  statuses,
  current,
}: {
  cardId: number;
  statuses: { id: number; name: string }[];
  current: number;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(String(current));
  useEffect(() => setSelected(String(current)), [current]);
  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-full sm:w-64"
        value={selected}
        disabled={saving}
        options={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
        onChange={async (v) => {
          if (v === String(current)) return;
          setSaving(true); setError("");
          try { await setCardStatusAction(cardId, Number(v)); setSelected(v); }
          catch { setError("Dieser Statuswechsel ist nicht erlaubt oder konnte nicht gespeichert werden."); }
          finally { setSaving(false); }
        }}
      />
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      {saving && <span className="text-xs text-slate-400">…</span>}
    </div>
  );
}
