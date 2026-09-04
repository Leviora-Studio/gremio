// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { clsx } from "clsx";
import { AnchoredPopover } from "./AnchoredPopover";

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
  ariaLabel,
  portal = false,
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
  ariaLabel?: string;
  portal?: boolean;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? value : internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  // Per Pfeiltasten hervorgehobener Eintrag (Index in visibleOptions).
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // Beim Öffnen: Suchfeld leeren und fokussieren.
  useEffect(() => {
    if (open && searchable) {
      setQuery("");
      searchRef.current?.focus();
    }
  }, [open, searchable]);

  // Hervorhebung bei Öffnen/Filtern zurücksetzen und ins Sichtfeld scrollen.
  useEffect(() => setActive(0), [open, query]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(val: string) {
    if (!isControlled) setInternal(val);
    onChange?.(val);
    setOpen(false);
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
  }

  const selectedLabel = options.find((o) => o.value === current)?.label;
  const q = query.trim().toLowerCase();
  const visibleOptions =
    searchable && q
      ? options.filter((o) => o.label.toLowerCase().includes(q))
      : options;

  // Tastatursteuerung: ↑/↓ navigieren, Enter bestätigt, Esc schließt.
  function handleKey(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, visibleOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = visibleOptions[active];
      if (opt) choose(opt.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const menu = <div ref={menuRef} id={menuId} className={`${portal ? "" : "absolute z-30 mt-1 "}w-full rounded-md border border-slate-200 bg-white text-sm shadow-lg`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); ref.current?.querySelector("button")?.focus(); } }}>
    {searchable && <div className="border-b border-slate-100 p-1.5"><input ref={searchRef} autoFocus={portal} type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>}
    <ul role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-auto py-1">
      {visibleOptions.length === 0 ? <li className="px-3 py-1.5 text-slate-400">Keine Treffer</li> : visibleOptions.map((o, idx) => <li key={o.value}><button ref={idx === active ? activeRef : null} type="button" role="option" aria-selected={o.value === current} onClick={() => choose(o.value)} onMouseEnter={() => setActive(idx)} className={clsx("block w-full px-3 py-1.5 text-left", idx === active && "bg-brand-50", o.value === current ? "font-medium text-brand-700" : "text-slate-700")}>{o.label}</button></li>)}
    </ul>
  </div>;
  return (
    <div ref={ref} className={clsx("relative", className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        // Maus-Klick klappt auf/zu. Tastatur-„Klicks" (Enter/Space erzeugen einen
        // synthetischen Klick mit e.detail===0) ignorieren — die behandelt
        // onKeyDown, sonst würde direkt wieder auf-/zugeklappt.
        onClick={(e) => {
          if (e.detail === 0) return;
          if (!disabled) setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          } else {
            // Bei searchable liegt der Fokus im Suchfeld; ohne Suche navigiert/
            // bestätigt die Tastatur direkt hier auf dem Button.
            handleKey(e);
          }
        }}
        className={clsx(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus-visible:border-brand-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500",
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

      {open && (portal ? <AnchoredPopover anchor={ref}>{menu}</AnchoredPopover> : menu)}
    </div>
  );
}
