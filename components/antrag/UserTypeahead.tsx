// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useState } from "react";
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

  function choose(user: U | null) {
    setSelected(user);
    onChange?.(user);
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

  return (
    <div className="relative">
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
          />
          {open && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      choose(u);
                      setOpen(false);
                      setQuery("");
                    }}
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
