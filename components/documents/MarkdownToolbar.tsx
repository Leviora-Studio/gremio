// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MarkdownCommand } from "@/lib/markdown-formatting";

export function MarkdownToolbar({ disabled, onCommand, onCapture, leading, after, trailing }: { disabled: boolean; onCommand: (command: MarkdownCommand) => void; onCapture: () => void; leading?: ReactNode; after?: ReactNode; trailing?: ReactNode }) {
  const [tableOpen, setTableOpen] = useState(false);
  const tablePickerId = useId();
  const [size, setSize] = useState({ rows: 2, columns: 3 });
  const toolbar = useRef<HTMLDivElement>(null);
  const tableButton = useRef<HTMLButtonElement>(null);
  const tablePicker = useRef<HTMLDivElement>(null);
  const [pickerPosition, setPickerPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!tableOpen || disabled) return;
    const updatePosition = () => {
      if (!toolbar.current || !tableButton.current || !tablePicker.current) return;
      const bounds = toolbar.current.getBoundingClientRect();
      const trigger = tableButton.current.getBoundingClientRect();
      const scrollBounds = tableButton.current.closest("[data-document-toolbar-scroll]")!.getBoundingClientRect();
      if (trigger.right <= scrollBounds.left || trigger.left >= scrollBounds.right) {
        setTableOpen(false);
        return;
      }
      // Keep the popup outside the scrolling strip so it cannot be clipped.
      setPickerPosition({
        left: Math.max(8, Math.min(trigger.left - bounds.left, bounds.width - tablePicker.current.offsetWidth - 8)),
        top: trigger.bottom - bounds.top - toolbar.current.clientTop + 4,
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(toolbar.current!);
    observer.observe(tableButton.current!);
    observer.observe(tablePicker.current!);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [tableOpen, disabled]);
  const buttons: [MarkdownCommand, string, string][] = [["h1", "H1", "Überschrift 1"], ["h2", "H2", "Überschrift 2"], ["h3", "H3", "Überschrift 3"], ["bold", "F", "Fettdruck"], ["italic", "K", "Kursiv"], ["underline", "U", "Unterstrichen"], ["bullet", "• Liste", "Aufzählung"], ["ordered", "1. Liste", "Nummerierte Liste"], ["quote", "Zitat", "Zitat"], ["code", "Code", "Code"]];
  return <div ref={toolbar} data-document-toolbar className="relative flex min-w-0 items-center gap-2 border-t border-slate-100 bg-slate-50/80 px-3 py-1.5 sm:px-4" onKeyDown={e => { if (e.key === "Escape") setTableOpen(false); }}>
    <div data-document-toolbar-scroll className="flex min-w-0 flex-1 items-center overflow-x-auto">
    {leading && <div className="mr-3 flex shrink-0 items-center gap-2 border-r border-slate-200 pr-3">{leading}</div>}
    <div role="group" aria-label="Markdown formatieren" className="flex shrink-0 items-center gap-1">
      {buttons.map(([command, text, title]) => <button key={String(command)} type="button" disabled={disabled} title={title} aria-label={title} onMouseDown={e => { e.preventDefault(); onCapture(); }} onClick={() => onCommand(command)} className={`min-h-8 min-w-8 shrink-0 rounded px-2.5 py-1.5 text-[13px] text-slate-600 hover:bg-slate-200 focus-visible:bg-slate-200 focus-visible:outline-none disabled:opacity-40 ${command === "bold" ? "font-bold" : command === "italic" ? "italic" : command === "underline" ? "underline" : "font-medium"}`}>{text}</button>)}
      <button ref={tableButton} type="button" disabled={disabled} aria-expanded={tableOpen} aria-controls={tablePickerId} className="min-h-8 min-w-8 shrink-0 rounded px-2.5 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40" onMouseDown={e => { e.preventDefault(); onCapture(); }} onClick={() => setTableOpen(!tableOpen)}>Tabellen</button>
    </div>
    {after && <div className="ml-3 flex shrink-0 items-center border-l border-slate-200 pl-3">{after}</div>}
    </div>
    {trailing && <div className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2">{trailing}</div>}
    {tableOpen && !disabled && <div ref={tablePicker} id={tablePickerId} style={pickerPosition} className="absolute z-30 w-64 max-w-[calc(100%-1rem)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg" role="group" aria-label="Tabelle einfügen">
      <p className="mb-2 text-sm font-medium">{size.columns} Spalten × {size.rows} Datenzeilen</p>
      <div className="grid grid-cols-6 gap-1">
        {Array.from({ length: 36 }, (_, i) => ({ rows: Math.floor(i / 6) + 1, columns: i % 6 + 1 })).map(cell => <button key={`${cell.rows}-${cell.columns}`} type="button" aria-label={`${cell.columns} Spalten, ${cell.rows} Datenzeilen`} className={`h-6 w-7 rounded-sm border ${cell.rows <= size.rows && cell.columns <= size.columns ? "border-brand-400 bg-brand-100" : "border-slate-200 bg-white"}`} onMouseEnter={() => setSize(cell)} onFocus={() => setSize(cell)} onMouseDown={e => e.preventDefault()} onClick={() => { onCommand({ table: cell }); setTableOpen(false); }} />)}
      </div>
      <p className="mt-2 text-xs text-slate-500">Plus eine Kopfzeile. Größe anklicken.</p>
      <button type="button" className="mt-3 text-xs text-slate-600 underline" onClick={() => setTableOpen(false)}>Schließen</button>
    </div>}
  </div>;
}
