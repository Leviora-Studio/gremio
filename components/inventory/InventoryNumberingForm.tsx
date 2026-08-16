// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition } from "react";
import {
  updateInventoryNumberingAction,
  type LoanBoardState,
} from "@/app/intern/inventar/[id]/einstellungen/actions";

type FormCfg = {
  enabled: boolean;
  prefix: string;
  year: string;
  separator: string;
  padding: string;
  next: string;
};

/**
 * Vorschau der nächsten Inventarnummer: Präfix, Jahr, dann die (aufgefüllte)
 * Ziffer — leere Blöcke werden übersprungen. Spiegelt buildInventoryNumber
 * (bewusst hier neu, damit die serverseitige lib nicht in den Client-Bundle
 * gezogen wird).
 */
function preview(c: FormCfg): string {
  const n = parseInt(c.next, 10);
  const counter = Number.isFinite(n) ? n : 0;
  const pad = parseInt(c.padding, 10);
  const num =
    Number.isFinite(pad) && pad > 0
      ? String(counter).padStart(pad, "0")
      : String(counter);
  return [c.prefix, c.year, num].filter((p) => p !== "").join(c.separator);
}

export function InventoryNumberingForm({
  boardId,
  config,
}: {
  boardId: number;
  config: {
    enabled: boolean;
    prefix: string;
    year: string;
    separator: string;
    padding: number;
    next: number;
  };
}) {
  const [c, setC] = useState<FormCfg>({
    enabled: config.enabled,
    prefix: config.prefix,
    year: config.year,
    separator: config.separator,
    padding: String(config.padding),
    next: String(config.next),
  });
  const set = (patch: Partial<FormCfg>) => setC((p) => ({ ...p, ...patch }));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<LoanBoardState>({});

  function save() {
    const fd = new FormData();
    fd.set("boardId", String(boardId));
    if (c.enabled) fd.set("enabled", "on");
    fd.set("prefix", c.prefix);
    fd.set("year", c.year);
    fd.set("separator", c.separator);
    fd.set("padding", c.padding);
    fd.set("next", c.next);
    startTransition(async () => {
      setMsg({});
      const res = await updateInventoryNumberingAction({} as LoanBoardState, fd);
      setMsg(res);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Automatisch vergebene Nummer beim Anlegen eines Gegenstands. Format:
        Präfix {c.separator || "_"} Jahr {c.separator || "_"} Ziffer (leere Teile
        werden übersprungen).
      </p>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="h-4 w-4"
        />
        Automatische Nummerierung aktiv
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Präfix</label>
          <input
            value={c.prefix}
            onChange={(e) => set({ prefix: e.target.value })}
            className="input"
            placeholder="INV"
          />
        </div>
        <div>
          <label className="label">Jahr</label>
          <input
            value={c.year}
            onChange={(e) => set({ year: e.target.value })}
            className="input"
            placeholder="2026"
          />
        </div>
        <div>
          <label className="label">Trennzeichen</label>
          <input
            value={c.separator}
            onChange={(e) => set({ separator: e.target.value })}
            className="input"
            placeholder="_"
          />
        </div>
        <div>
          <label className="label">Stellen (Auffüllen)</label>
          <input
            value={c.padding}
            onChange={(e) => set({ padding: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="input"
            placeholder="0"
          />
        </div>
        <div>
          <label className="label">Nächste Nummer</label>
          <input
            value={c.next}
            onChange={(e) => set({ next: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="input"
            placeholder="1"
          />
        </div>
      </div>

      <div className="rounded-md bg-slate-50 p-3 text-sm">
        Nächste Inventarnummer:{" "}
        <span className="font-semibold text-brand-700">{preview(c) || "—"}</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-primary"
        >
          Nummerierung speichern
        </button>
        {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
        {msg.success && (
          <span className="text-sm text-green-600">{msg.success}</span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Der Zähler erhöht sich automatisch; Änderungen wirken nur auf neue
        Gegenstände. Bei Jahreswechsel Jahr anpassen und „Nächste Nummer"
        zurücksetzen.
      </p>
    </div>
  );
}
