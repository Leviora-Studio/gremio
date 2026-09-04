// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useState } from "react";

export type { ProtocolSuggestion } from "@/lib/protocols";
import type { ProtocolSuggestion } from "@/lib/protocols";
export function ProtocolFinancePanel({ suggestions, linkedIds, disabled, tops, onTop, onInsert, onRemove, onJump, onDrag, onDragEnd }: {
  suggestions: ProtocolSuggestion[]; linkedIds: Set<number>; disabled: boolean; tops: Record<number, string>;
  onTop: (id: number, top: string) => void; onInsert: (card: ProtocolSuggestion) => void; onRemove: (id: number) => void; onJump: (id: number) => void; onDrag: (id: number) => void; onDragEnd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const ordered = [...suggestions].sort((a, b) => Number(linkedIds.has(a.id)) - Number(linkedIds.has(b.id))).filter(card => (filter === "all" || linkedIds.has(card.id) === (filter === "linked")) && `${card.number ?? ""} ${card.title} ${card.applicant ?? ""}`.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));
  return <div className="space-y-3">
    <h2 className="text-sm font-semibold">Finanzanträge</h2>
    <input aria-label="Finanzanträge suchen" className="input text-sm" placeholder="Titel, Nummer oder Antragsteller …" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="flex gap-1" role="group" aria-label="Finanzanträge filtern">{[["all", "Alle"], ["open", "Offen"], ["linked", "Im Protokoll"]].map(([value, label]) => <button key={value} type="button" aria-pressed={value === filter} onClick={() => setFilter(value)} className={`rounded px-2 py-1 text-xs ${filter === value ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"}`}>{label}</button>)}</div>
    {!ordered.length && <p className="text-sm text-slate-500">Keine passenden Finanzanträge.</p>}
    {ordered.map(card => {
      const linked = linkedIds.has(card.id);
      return <article key={card.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" draggable={!linked && !disabled && !!tops[card.id]?.trim()} onDragStart={e => { if (linked || disabled || !tops[card.id]?.trim()) { e.preventDefault(); return; } onDrag(card.id); e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("application/x-gremio-card", String(card.id)); }} onDragEnd={onDragEnd}>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{card.number || `Karte ${card.id}`}</span><span>{card.amount == null ? "—" : (card.amount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</span></div>
        <h3 className="text-sm font-medium">{card.title}</h3>
        {linked && <span className="inline-block rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">im Protokoll</span>}
        {linked ? <div className="flex flex-wrap gap-3"><button type="button" onClick={() => onJump(card.id)} className="text-xs text-brand-600 hover:underline">Zum TOP springen</button><button type="button" disabled={disabled} onClick={() => onRemove(card.id)} className="text-xs text-slate-500 hover:underline disabled:opacity-40">Entfernen</button></div> : <div className="flex gap-2"><input aria-label={`TOP für ${card.title}`} className="input min-w-0 flex-1 text-sm" placeholder="TOP, z. B. 5.1" value={tops[card.id] ?? ""} onChange={e => onTop(card.id, e.target.value)} /><button type="button" disabled={disabled || !tops[card.id]?.trim()} className="btn-secondary btn-sm" onMouseDown={e => e.preventDefault()} onClick={() => onInsert(card)}>Einfügen</button></div>}
      </article>;
    })}
  </div>;
}
