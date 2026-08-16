// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useState } from "react";
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
  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-full sm:w-64"
        defaultValue={String(current)}
        disabled={saving}
        options={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
        onChange={async (v) => {
          setSaving(true);
          await setCardStatusAction(cardId, Number(v));
          setSaving(false);
        }}
      />
      {saving && <span className="text-xs text-slate-400">…</span>}
    </div>
  );
}
