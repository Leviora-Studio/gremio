// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState } from "react";
import { deleteInventoryBoardAction } from "@/app/intern/inventar/[id]/einstellungen/actions";

export function DeleteInventoryBoardButton({ boardId }: { boardId: number }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="btn-secondary text-red-600"
      >
        Inventar löschen
      </button>
    );
  }
  return (
    <form action={deleteInventoryBoardAction} className="flex items-center gap-2">
      <input type="hidden" name="boardId" value={boardId} />
      <span className="text-sm text-slate-600">
        Inkl. aller Gegenstände — sicher?
      </span>
      <button type="submit" className="btn-secondary text-red-600">
        Endgültig löschen
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="text-sm text-slate-500"
      >
        Abbrechen
      </button>
    </form>
  );
}
