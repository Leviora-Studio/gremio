// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnchoredPopover } from "./AnchoredPopover";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseISO(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function formatDE(s: string): string {
  const d = parseISO(s);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : "";
}
function sameDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function DatePicker({
  value,
  defaultValue,
  onChange,
  name,
  placeholder = "Datum wählen…",
  disabled,
  className,
  ariaLabel,
  portal = false,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  portal?: boolean;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? (value as string) : internal;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = parseISO(current);
  const today = new Date();
  const [view, setView] = useState<Date>(selected ?? today);

  useEffect(() => {
    if (!open) return;
    // Beim Öffnen auf den ausgewählten Monat springen.
    setView(parseISO(current) ?? new Date());
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function commit(s: string) {
    if (!isControlled) setInternal(s);
    onChange?.(s);
    setOpen(false);
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
  }

  const year = view.getFullYear();
  const month = view.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Mo=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div ref={ref} className={clsx("relative", className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onKeyDown={e => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={clsx(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus-visible:border-brand-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500",
          disabled && "cursor-not-allowed bg-slate-50 opacity-60",
        )}
      >
        <span className={clsx(!current && "text-slate-400")}>
          {current ? formatDE(current) : placeholder}
        </span>
        <span aria-hidden className="text-slate-400">
          📅
        </span>
      </button>

      {open && (
        <AnchoredPopover anchor={ref} width={288} enabled={portal}>
        <div ref={menuRef} role="dialog" aria-label={ariaLabel ? `${ariaLabel}: Kalender` : "Kalender"} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); ref.current?.querySelector("button")?.focus(); } }} className={`${portal ? "w-full" : "absolute z-30 mt-1 w-72"} rounded-md border border-slate-200 bg-white p-3 shadow-lg`}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(year, month - 1, 1))}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Vorheriger Monat"
            >
              ‹
            </button>
            <span className="text-sm font-medium">
              {MONTHS[month]} {year}
            </span>
            <button
              type="button"
              onClick={() => setView(new Date(year, month + 1, 1))}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Nächster Monat"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) =>
              d ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => commit(toISO(d))}
                  className={clsx(
                    "h-8 rounded text-sm",
                    sameDay(d, selected)
                      ? "bg-brand-600 font-medium text-white"
                      : "hover:bg-brand-50",
                    !sameDay(d, selected) &&
                      sameDay(d, today) &&
                      "ring-1 ring-brand-300",
                  )}
                >
                  {d.getDate()}
                </button>
              ) : (
                <div key={i} />
              ),
            )}
          </div>

          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => commit(toISO(new Date()))}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Heute
            </button>
            <button
              type="button"
              onClick={() => commit("")}
              className="text-xs text-slate-500 hover:underline"
            >
              Löschen
            </button>
          </div>
        </div>
        </AnchoredPopover>
      )}
    </div>
  );
}
