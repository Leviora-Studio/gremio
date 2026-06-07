// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

export type SelectOption = { value: string; label: string };

export function Select({
  options,
  value,
  defaultValue,
  onChange,
  name,
  placeholder = "Bitte wählen…",
  disabled,
  className,
  id,
  searchable = false,
  searchPlaceholder = "Suchen…",
}: {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? value : internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Beim Öffnen: Suchfeld leeren und fokussieren.
  useEffect(() => {
    if (open && searchable) {
      setQuery("");
      searchRef.current?.focus();
    }
  }, [open, searchable]);

  function choose(val: string) {
    if (!isControlled) setInternal(val);
    onChange?.(val);
    setOpen(false);
  }

  const selectedLabel = options.find((o) => o.value === current)?.label;
  const q = query.trim().toLowerCase();
  const visibleOptions =
    searchable && q
      ? options.filter((o) => o.label.toLowerCase().includes(q))
      : options;

  return (
    <div ref={ref} className={clsx("relative", className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={clsx(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
          disabled && "cursor-not-allowed bg-slate-50 opacity-60",
        )}
      >
        <span className={clsx("truncate", !selectedLabel && "text-slate-400")}>
          {selectedLabel ?? placeholder}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          className={clsx(
            "shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        >
          <path
            d="M5 7.5 10 12.5 15 7.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {searchable && (
            <div className="border-b border-slate-100 p-1.5">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-60 overflow-auto py-1">
            {visibleOptions.length === 0 ? (
              <li className="px-3 py-1.5 text-slate-400">
                Keine Treffer
              </li>
            ) : (
              visibleOptions.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className={clsx(
                      "block w-full px-3 py-1.5 text-left hover:bg-brand-50",
                      o.value === current
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-slate-700",
                    )}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
