// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

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

export function UserTypeahead({
  boardId,
  name,
  initial,
  onChange,
}: {
  boardId: number;
  name?: string;
  initial: U | null;
  onChange?: (user: U | null) => void;
}) {
  const [selected, setSelected] = useState<U | null>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<U[]>([]);
  const [open, setOpen] = useState(false);
  // Per Pfeiltasten hervorgehobener Treffer.
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

  function choose(user: U | null) {
    setSelected(user);
    onChange?.(user);
  }

  function pick(u: U) {
    choose(u);
    setOpen(false);
    setQuery("");
  }

  // Tastatursteuerung: ↑/↓ navigieren, Enter bestätigt, Esc schließt.
  function handleKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
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

  // Hervorhebung bei neuen Treffern zurücksetzen und ins Sichtfeld scrollen.
  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div ref={rootRef} className="relative">
      {name && <input type="hidden" name={name} value={selected?.id ?? ""} />}
      {selected ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded bg-brand-50 px-2 py-1 text-sm text-brand-700">
            <Avatar username={label(selected)} src={avatarSrc(selected)} size={20} />
            {label(selected)}
          </span>
          <button
            type="button"
            onClick={() => {
              choose(null);
              setOpen(true);
            }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            ändern
          </button>
        </div>
      ) : (
        <>
          <input
            className="input"
            placeholder="Tippen zum Suchen…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {results.map((u, idx) => (
                <li key={u.id}>
                  <button
                    ref={idx === active ? activeRef : null}
                    type="button"
                    className={
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm" +
                      (idx === active ? " bg-brand-50" : " hover:bg-slate-50")
                    }
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => pick(u)}
                  >
                    <Avatar username={label(u)} src={avatarSrc(u)} size={22} />
                    {label(u)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
