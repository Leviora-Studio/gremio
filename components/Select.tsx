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
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? value : internal;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  function choose(val: string) {
    if (!isControlled) setInternal(val);
    onChange?.(val);
    setOpen(false);
  }

  const selectedLabel = options.find((o) => o.value === current)?.label;

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
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {options.map((o) => (
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
          ))}
        </ul>
      )}
    </div>
  );
}
