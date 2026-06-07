// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { saveTaskPrefsAction, type HomePref } from "@/app/intern/aufgaben/actions";

const SECTIONS: { key: keyof HomePref; label: string }[] = [
  { key: "tasks", label: "Meine Aufgaben" },
  { key: "boards", label: "Boards" },
  { key: "finances", label: "Finanzübersichten" },
];

/**
 * Startseite mit frei wählbaren Abschnitten (Aufgaben / Boards / Finanzboards).
 * Ein-/Ausblenden wirkt sofort (Client-State) und wird im Hintergrund
 * gespeichert (atomarer JSONB-Merge → stört die Aufgaben-Settings nicht).
 */
export function HomeDashboard({
  home: initial,
  tasks,
  boards,
  finances,
}: {
  home: HomePref;
  tasks: ReactNode;
  boards: ReactNode;
  finances: ReactNode;
}) {
  const [home, setHome] = useState<HomePref>(initial);
  const [showSettings, setShowSettings] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveTaskPrefsAction({ home }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [home]);

  const noneVisible = !home.tasks && !home.boards && !home.finances;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Startseite</h1>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="btn-secondary"
        >
          ⚙ Startseite anpassen
        </button>
      </div>

      {showSettings && (
        <div className="card p-4">
          <p className="mb-2 text-sm text-slate-600">
            Welche Bereiche möchtest du auf deiner Startseite sehen?
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {SECTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={home[s.key]}
                  onChange={(e) =>
                    setHome((h) => ({ ...h, [s.key]: e.target.checked }))
                  }
                  className="h-4 w-4"
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {home.tasks && <section>{tasks}</section>}
      {home.boards && <section>{boards}</section>}
      {home.finances && <section>{finances}</section>}

      {noneVisible && (
        <div className="card p-8 text-center text-slate-500">
          Keine Bereiche ausgewählt — über „Startseite anpassen" wieder
          einblenden.
        </div>
      )}
    </div>
  );
}
