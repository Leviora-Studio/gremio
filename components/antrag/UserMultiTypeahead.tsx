// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Avatar } from "@/components/Avatar";

type U = {
  id: number;
  username: string;
  name?: string | null;
  avatarPath?: string | null;
};

function avatarSrc(u: U): string | null {
  return u.avatarPath ? `/api/avatar/${u.id}` : null;
}
function label(u: U): string {
  return u.name || u.username;
}

/**
 * Mehrfach-Auswahl von Board-Nutzern (für „Zugewiesen zu"). Ausgewählte als
 * entfernbare Chips, Tippen sucht weitere; ↑/↓ + Enter zum Auswählen, Backspace
 * im leeren Feld entfernt den letzten Chip.
 */
export function UserMultiTypeahead({
  boardId,
  initial,
  onChange,
}: {
  boardId: number;
  initial: U[];
  onChange: (users: U[]) => void;
}) {
  const [selected, setSelected] = useState<U[]>(initial);
  // Liefert der Server eine andere Zuweisungsliste (Reload/externe Änderung),
  // lokale Auswahl nachziehen. Schlüssel = sortierte IDs; ändert sich der nicht,
  // bleiben laufende Bearbeitungen unangetastet (auch nach Save+Revalidate, da
  // der Server dann genau die gerade gewählte Liste zurückgibt).
  const initialKey = initial
    .map((u) => u.id)
    .sort((a, b) => a - b)
    .join(",");
  const [syncedKey, setSyncedKey] = useState(initialKey);
  if (initialKey !== syncedKey) {
    setSyncedKey(initialKey);
    setSelected(initial);
  }
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<U[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Beim Klick außerhalb schließen.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function commit(next: U[]) {
    setSelected(next);
    onChange(next);
  }
  function add(u: U) {
    if (selected.some((s) => s.id === u.id)) return;
    commit([...selected, u]);
    setQuery("");
  }
  function remove(id: number) {
    commit(selected.filter((s) => s.id !== id));
  }

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/board/${boardId}/users?q=${encodeURIComponent(query)}`,
          { signal: ctrl.signal },
        );
        if (res.ok) {
          const data = (await res.json()) as { users: U[] };
          setResults(data.users);
        }
      } catch {
        /* abgebrochen */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open, boardId]);

  // Bereits Ausgewählte nicht erneut vorschlagen.
  const candidates = results.filter((u) => !selected.some((s) => s.id === u.id));

  useEffect(() => setActive(0), [results, selected]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function handleKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && candidates[active]) {
        e.preventDefault();
        add(candidates[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && selected.length) {
      remove(selected[selected.length - 1].id);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
        {selected.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded bg-brand-50 py-0.5 pl-1 pr-0.5 text-brand-700"
          >
            <Avatar username={label(u)} src={avatarSrc(u)} size={18} />
            {label(u)}
            <button
              type="button"
              onClick={() => remove(u.id)}
              className="rounded px-1 text-brand-400 hover:text-brand-700"
              title="Entfernen"
              aria-label={`${label(u)} entfernen`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
          placeholder={selected.length ? "Weitere…" : "Tippen zum Suchen…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
        />
      </div>
      {open && candidates.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {candidates.map((u, idx) => (
            <li key={u.id}>
              <button
                ref={idx === active ? activeRef : null}
                type="button"
                className={
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm" +
                  (idx === active ? " bg-brand-50" : " hover:bg-slate-50")
                }
                onMouseEnter={() => setActive(idx)}
                onClick={() => add(u)}
              >
                <Avatar username={label(u)} src={avatarSrc(u)} size={22} />
                {label(u)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
