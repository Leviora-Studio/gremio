// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { officeCanMove, type OfficeMoveRules } from "@/lib/board-move-policy";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Select } from "@/components/Select";
import { CARD_FIELD_LABELS, type CardFieldKey } from "@/lib/constants";
import { todayInBerlin } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { PriorityOption } from "@/lib/priorities";
import type { KanbanCard } from "./KanbanBoard";

export type BoardView = "kanban" | "list" | "table" | "calendar";
type Status = { id: number; name: string };
const tableFields = new Set(["number", "applicant", "submitter_email", "assignee", "priority", "deadline", "meeting", "budget_title", "account", "requested_amount", "approved_amount", "actual_amount", "instruction_date", "transfer_date", "decision_ref"]);
const dateLabel = (date: string) => date.split("-").reverse().join(".");

export function BoardViews({ view, cards, statuses, visible, priorities, preferenceKey, onMove, resultFocusKey, canEdit = true, officeMoveRules }: {
  view: Exclude<BoardView, "kanban">;
  cards: KanbanCard[];
  statuses: Status[];
  visible: string[];
  priorities: PriorityOption[];
  preferenceKey?: string;
  resultFocusKey: string;
  canEdit?: boolean;
  officeMoveRules?: OfficeMoveRules | null;
  onMove: (cardId: number, statusId: number) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<number[]>([]);
  const [searchCollapsed, setSearchCollapsed] = useState<number[]>([]);
  const tableViewport = useRef<HTMLDivElement>(null);
  const searchActive = resultFocusKey !== "";
  useEffect(() => {
    setSearchCollapsed([]);
  }, [resultFocusKey, view]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState("title");
  const [descending, setDescending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dateField, setDateField] = useState("deadline");
  const [month, setMonth] = useState(() => todayInBerlin().slice(0, 7));
  const [agenda, setAgenda] = useState(false);
  useEffect(() => {
    setCollapsed([]); setHidden([]); setColumnOrder([]); setHiddenGroups([]);
    try {
      const saved = JSON.parse(preferenceKey ? localStorage.getItem(`${preferenceKey}:layout`) ?? "{}" : "{}");
      if (Array.isArray(saved.hiddenGroups)) setHiddenGroups(saved.hiddenGroups.filter((id: unknown) => typeof id === "number" && Number.isSafeInteger(id)));
      if (Array.isArray(saved.collapsed)) setCollapsed(saved.collapsed.filter((id: unknown) => typeof id === "number"));
      if (Array.isArray(saved.columnOrder)) setColumnOrder([...new Set(saved.columnOrder.filter((key: unknown): key is string => typeof key === "string"))] as string[]);
      if (Array.isArray(saved.hidden)) setHidden(saved.hidden.filter((key: unknown) => typeof key === "string"));
    } catch { /* Invalid or unavailable storage must not prevent use. */ }
  }, [preferenceKey]);
  function saveLayout(nextCollapsed: number[], nextHidden: string[], nextOrder = columnOrder, nextHiddenGroups = hiddenGroups) {
    setCollapsed(nextCollapsed); setHidden(nextHidden); setColumnOrder(nextOrder); setHiddenGroups(nextHiddenGroups);
    try { if (preferenceKey) localStorage.setItem(`${preferenceKey}:layout`, JSON.stringify({ collapsed: nextCollapsed, hidden: nextHidden, columnOrder: nextOrder, hiddenGroups: nextHiddenGroups })); } catch { /* Optional preference. */ }
  }
  function collapseGroups(next: number[]) {
    if (searchActive) setSearchCollapsed(next);
    else saveLayout(next, hidden);
  }
  const shownGroups = statuses.filter(status => searchActive ? cards.some(card => card.statusId === status.id) : !hiddenGroups.includes(status.id));
  const hiddenStatuses = statuses.filter(status => hiddenGroups.includes(status.id));
  function toggleGroup(statusId: number) {
    saveLayout(collapsed, hidden, columnOrder, hiddenGroups.includes(statusId) ? hiddenGroups.filter(id => id !== statusId) : [...hiddenGroups, statusId]);
  }
  const effectiveCollapsed = searchActive ? searchCollapsed : collapsed;
  const fields = visible.filter(key => tableFields.has(key));
  const columns = fields.filter(key => !hidden.includes(key));
  const availableColumns = ["title", "status", ...fields];
  const orderedColumns = [...columnOrder.filter(key => availableColumns.includes(key)), ...availableColumns.filter(key => !columnOrder.includes(key))];
  const tableColumns = orderedColumns.filter(key => key === "title" || key === "status" || !hidden.includes(key));
  const tableColumnKey = tableColumns.join("|");
  useEffect(() => {
    if (!resultFocusKey || view !== "table") return;
    const viewport = tableViewport.current;
    const header = viewport?.querySelector<HTMLElement>('[data-column-key="title"]');
    if (viewport && header) viewport.scrollLeft += header.getBoundingClientRect().left - viewport.getBoundingClientRect().left - viewport.clientLeft;
  }, [resultFocusKey, view, tableColumnKey]);
  const columnSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function moveColumn({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = orderedColumns.indexOf(String(active.id));
    const to = orderedColumns.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    saveLayout(collapsed, hidden, arrayMove(orderedColumns, from, to));
  }
  const columnLabel = (key: string) => key === "title" ? "Titel" : key === "status" ? "Status" : CARD_FIELD_LABELS[key as CardFieldKey];
  const effectiveSort = ["title", "status", ...columns].includes(sort) ? sort : "title";
  const priorityMap = new Map(priorities.map(p => [p.id, p.label]));
  function value(card: KanbanCard, key: string): string | number | null {
    switch (key) {
      case "title": return card.title;
      case "status": return statuses.find(s => s.id === card.statusId)?.name ?? "";
      case "number": return card.number;
      case "applicant": return card.applicant;
      case "assignee": return card.assignees.map(a => a.name).join(", ");
      case "priority": return card.priorityId == null ? null : priorityMap.get(card.priorityId) ?? null;
      case "deadline": return card.deadline;
      case "meeting": return card.meeting;
      default: return card.fields?.[key] ?? null;
    }
  }
  function display(card: KanbanCard, key: string) {
    const v = value(card, key);
    if (v == null || v === "") return "—";
    if (key.endsWith("_amount") && typeof v === "number") return formatCents(v);
    if (["deadline", "meeting", "instruction_date", "transfer_date"].includes(key)) return dateLabel(String(v));
    return String(v);
  }
  function title(card: KanbanCard) {
    return <><Link className="font-medium text-brand-700 hover:underline" href={`/intern/card/${card.id}`}>{card.title}</Link>
      {card.resubmitted && <span className="ml-2 inline-block whitespace-nowrap rounded bg-amber-100 px-1 text-xs text-amber-800">Nachgereicht</span>}</>;
  }
  function statusSelect(card: KanbanCard) {
    const allowedTargets = statuses.filter(status => canEdit || status.id === card.statusId || officeCanMove(officeMoveRules, card.statusId, status.id));
    if (!canEdit && allowedTargets.length < 2) return <span className="text-sm text-slate-600">{value(card, "status")}</span>;
    return <Select portal ariaLabel={`Status für ${card.title}`} value={String(card.statusId)} disabled={pending}
      options={allowedTargets.map(s => ({ value: String(s.id), label: s.name }))}
      onChange={async next => {
        if (Number(next) === card.statusId) return;
        setPending(true); setError("");
        try { await onMove(card.id, Number(next)); }
        catch { setError("Der Status konnte nicht gespeichert werden. Bitte erneut versuchen."); }
        finally { setPending(false); }
      }} />;
  }
  const empty = <p className="p-4 text-sm text-slate-500">Keine Karten für die aktuelle Auswahl.</p>;
  const dateFields = [
    ...(visible.includes("deadline") ? [{ value: "deadline", label: "Fristen" }] : []),
    ...(visible.includes("meeting") ? [{ value: "meeting", label: "Sitzungen" }] : []),
  ];
  const effectiveDateField = dateFields.some(f => f.value === dateField) ? dateField : dateFields[0]?.value;
  const cardDate = (card: KanbanCard) => effectiveDateField === "meeting" ? card.meeting : card.deadline;
  const matchingDates = cards.map(cardDate).filter((date): date is string => !!date).sort();
  const matchingMonthsKey = [...new Set(matchingDates.map(date => date.slice(0, 7)))].join(",");
  useEffect(() => {
    if (!resultFocusKey || view !== "calendar" || !matchingMonthsKey) return;
    const months = matchingMonthsKey.split(",");
    setMonth(current => months.includes(current) ? current : months[0]);
  }, [resultFocusKey, view, effectiveDateField, matchingMonthsKey]);
  const onlyUndatedResults = searchActive && matchingDates.length === 0;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (monthStart.getUTCDay() + 6) % 7;
  const monthTitle = monthStart.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  function shiftMonth(delta: number) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7));
  }
  function calendarCard(card: KanbanCard) {
    return <div key={card.id} className="min-w-0 rounded border border-slate-200 bg-white p-2 text-xs [overflow-wrap:anywhere]">
      {visible.includes("number") && card.number && <div className="text-slate-500">{card.number}</div>}
      {title(card)}<div className="mt-1 text-slate-500">{value(card, "status")}</div>
    </div>;
  }
  return <div aria-busy={pending}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {view === "list" && <>
      <details className="mb-3 rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Gruppen auswählen</summary>
        <p className="mt-2 text-xs text-slate-500">Wähle die Spalten, die als Gruppen angezeigt werden. Such- und Filtertreffer werden auch in ausgeblendeten Gruppen vorübergehend angezeigt.</p>
        <div className="mt-3 flex flex-wrap gap-4">{statuses.map(status => <label key={status.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label={`Gruppe ${status.name} anzeigen`} checked={!hiddenGroups.includes(status.id)} onChange={() => toggleGroup(status.id)} />{status.name}
        </label>)}</div>
      </details>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => collapseGroups([])}>Alle aufklappen</button>
        <button type="button" className="btn-secondary" onClick={() => collapseGroups(statuses.map(s => s.id))}>Alle zuklappen</button>
      </div>
      {searchActive && cards.length === 0 && empty}
      {!searchActive && shownGroups.length === 0 && <p className="mb-3 text-sm text-slate-500">Alle Gruppen sind ausgeblendet. Du kannst sie unten wieder einblenden.</p>}
      <div className="space-y-3">{shownGroups.map(status => {
        const items = cards.filter(c => c.statusId === status.id);
        const open = !effectiveCollapsed.includes(status.id);
        return <section key={status.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <h2><button type="button" className="flex w-full items-center gap-2 bg-slate-100 p-3 text-left font-semibold" aria-expanded={open}
            aria-controls={`board-status-${status.id}`} onClick={() => collapseGroups(open ? [...effectiveCollapsed, status.id] : effectiveCollapsed.filter(id => id !== status.id))}>
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>{status.name}{searchActive && hiddenGroups.includes(status.id) && <span className="text-xs font-normal text-slate-500">Durch Suche/Filter eingeblendet</span>}<span className="ml-auto rounded bg-slate-200 px-2 text-sm">{items.length}</span>
          </button></h2>
          <div id={`board-status-${status.id}`} hidden={!open}>
            {items.length === 0 ? empty : <ul className="divide-y divide-slate-100">{items.map(card => <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {visible.includes("number") && card.number && <span className="mr-2 text-xs text-slate-500">{card.number}</span>}{title(card)}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">{["applicant", "submitter_email", "assignee", "priority", "deadline", "meeting"].filter(k => visible.includes(k) && value(card, k)).map(k =>
                  <span key={k} className={k === "deadline" && card.deadline! < todayInBerlin() ? "font-medium text-red-700" : ""}>{CARD_FIELD_LABELS[k as CardFieldKey]}: {display(card, k)}</span>)}</div>
              </div><div className="w-full sm:w-52">{statusSelect(card)}</div>
            </li>)}</ul>}
          </div>
        </section>;
      })}</div>
      {hiddenStatuses.length > 0 && <section aria-label="Ausgeblendete Gruppen" className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Ausgeblendet · {hiddenStatuses.length}</h2>
        <ul className="space-y-2">{hiddenStatuses.map(status => <li key={status.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span>{status.name} · {cards.filter(card => card.statusId === status.id).length}</span>
          <button type="button" className="btn-secondary btn-sm" aria-label={`${status.name} einblenden`} onClick={() => toggleGroup(status.id)}>Einblenden</button>
        </li>)}</ul>
      </section>}
    </>}
    {view === "table" && <>
      <details className="mb-3 rounded border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Tabellenspalten auswählen</summary>
        <p className="mt-2 text-xs text-slate-500">Ziehe Spalten am Griff in die gewünschte Reihenfolge – hier oder direkt in der Tabellenüberschrift. Die Reihenfolge wird für dich auf diesem Board gespeichert.</p>
        <DndContext id="board-column-options" sensors={columnSensors} collisionDetection={closestCenter} onDragEnd={moveColumn}>
          <SortableContext items={orderedColumns} strategy={verticalListSortingStrategy}>
        <ol className="mt-3 space-y-2">{orderedColumns.map(key => <SortableColumnOption key={key} columnKey={key} label={columnLabel(key)}>
          {key === "title" || key === "status" ? <span className="text-sm">{columnLabel(key)}</span> : <label className="flex min-w-0 items-center gap-2 text-sm">
            <input type="checkbox" checked={!hidden.includes(key)} onChange={() => saveLayout(collapsed, hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key])} />{columnLabel(key)}
          </label>}
        </SortableColumnOption>)}</ol>
          </SortableContext>
        </DndContext>
        <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => saveLayout(collapsed, hidden, [])}>Reihenfolge zurücksetzen</button>
      </details>
      <p className="mb-2 text-xs text-slate-500">{cards.length} Karten · Überschrift zum Sortieren anklicken, Griff zum Verschieben ziehen.</p>
      <DndContext id="board-table-columns" sensors={columnSensors} collisionDetection={closestCenter} onDragEnd={moveColumn}>
      <div ref={tableViewport} className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-slate-100"><tr><SortableContext items={tableColumns} strategy={horizontalListSortingStrategy}>
          {tableColumns.map(key => <SortableColumnHeader key={key} columnKey={key} label={columnLabel(key)} sortDirection={effectiveSort === key ? descending ? "descending" : "ascending" : "none"}
            onSort={() => { setDescending(effectiveSort === key ? !descending : false); setSort(key); }} />)}
        </SortableContext></tr></thead>
        <tbody className="divide-y divide-slate-100">{[...cards].sort((a, b) => {
          const av = value(a, effectiveSort), bv = value(b, effectiveSort);
          if (av == null || av === "") return bv == null || bv === "" ? 0 : 1;
          if (bv == null || bv === "") return -1;
          return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "de", { numeric: true })) * (descending ? -1 : 1);
        }).map(card => <tr key={card.id}>
          {tableColumns.map(key => key === "title" ? <td key={key} className="min-w-52 p-3">{title(card)}</td> : key === "status" ? <td key={key} className="min-w-56 p-3">{statusSelect(card)}</td> : <td key={key} className={`whitespace-nowrap p-3 ${key === "deadline" && card.deadline && card.deadline < todayInBerlin() ? "font-medium text-red-700" : ""}`}>{display(card, key)}</td>)}
        </tr>)}</tbody>
      </table>{cards.length === 0 && empty}</div>
      </DndContext>
    </>}
    {view === "calendar" && (dateFields.length === 0 ? <p className="rounded border p-4 text-sm text-slate-500">Für den Kalender muss das Feld „Deadline“ oder „Sitzung“ in den Board-Einstellungen aktiviert sein.</p> : <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-40"><Select ariaLabel="Kalenderdatum" value={effectiveDateField} options={dateFields} onChange={setDateField} /></div>
        <button type="button" className="btn-secondary" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}>←</button>
        <button type="button" className="btn-secondary" onClick={() => setMonth(todayInBerlin().slice(0, 7))}>Heute</button>
        <button type="button" className="btn-secondary" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}>→</button>
        <h2 className="font-semibold" aria-live="polite">{monthTitle}</h2>
        <button type="button" className="btn-secondary hidden sm:ml-auto sm:inline-flex" aria-pressed={agenda} onClick={() => setAgenda(!agenda)}>{agenda ? "Monatsraster" : "Terminliste"}</button>
      </div>
      <div className={agenda || onlyUndatedResults ? "hidden" : "hidden sm:block"}>
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200 bg-slate-200 gap-px">
          {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(day => <div key={day} className="bg-slate-100 p-2 text-center text-xs font-semibold">{day}</div>)}
          {Array.from({ length: Math.ceil((offset + dayCount) / 7) * 7 }, (_, index) => {
            const day = index - offset + 1;
            if (day < 1 || day > dayCount) return <div key={index} className="bg-slate-50" />;
            const date = `${month}-${String(day).padStart(2, "0")}`;
            return <section key={date} aria-label={dateLabel(date)} className={`min-h-28 min-w-0 p-2 ${date === todayInBerlin() ? "bg-brand-50" : "bg-white"}`}>
              <div className="mb-2 text-xs font-semibold">{day}</div><div className="space-y-1">{cards.filter(c => cardDate(c) === date).map(calendarCard)}</div>
            </section>;
          })}
        </div>
      </div>
      <div className={onlyUndatedResults ? "hidden" : agenda ? "space-y-3" : "space-y-3 sm:hidden"}>
        {Array.from(new Set(cards.map(cardDate).filter((d): d is string => !!d && d.startsWith(month)))).sort().map(date => <section key={date}>
          <h3 className="mb-2 font-semibold">{dateLabel(date)}</h3><div className="space-y-2">{cards.filter(c => cardDate(c) === date).map(calendarCard)}</div>
        </section>)}
        {!cards.some(c => cardDate(c)?.startsWith(month)) && <p className="p-4 text-sm text-slate-500">Keine Termine in diesem Monat.</p>}
      </div>
      <section className="mt-4 rounded-lg border border-slate-200 p-3"><h3 className="mb-2 font-semibold">Ohne {effectiveDateField === "meeting" ? "Sitzungsdatum" : "Frist"} · {cards.filter(c => !cardDate(c)).length}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cards.filter(c => !cardDate(c)).map(calendarCard)}</div>
      </section>
    </>)}
  </div>;
}

function SortableColumnHeader({ columnKey, label, sortDirection, onSort }: {
  columnKey: string; label: string; sortDirection: "ascending" | "descending" | "none"; onSort: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: columnKey });
  return <th data-live-refresh-block={isDragging} ref={setNodeRef} data-column-key={columnKey} scope="col" aria-label={label} aria-sort={sortDirection}
    style={{ transform: CSS.Translate.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : undefined }}
    className={`whitespace-nowrap p-3 ${isDragging ? "bg-brand-50 shadow-lg" : "bg-slate-100"}`}>
    <div className="flex items-center gap-2">
      <button type="button" {...attributes} {...listeners} aria-label={`${label} verschieben`} title="Spalte ziehen"
        className="cursor-grab touch-none rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 active:cursor-grabbing"><svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/></svg></button>
      <button type="button" onClick={onSort}>{label}{sortDirection === "descending" ? " ↓" : sortDirection === "ascending" ? " ↑" : ""}</button>
    </div>
  </th>;
}

function SortableColumnOption({ columnKey, label, children }: { columnKey: string; label: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: columnKey });
  return <li data-live-refresh-block={isDragging} ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : undefined }}
    className={`flex items-center gap-3 rounded border p-2 ${isDragging ? "border-brand-300 bg-brand-50 shadow-lg" : "border-slate-100 bg-white"}`}>
    <button type="button" {...attributes} {...listeners} aria-label={`${label} in Spaltenauswahl verschieben`} title="Spalte ziehen"
      className="cursor-grab touch-none rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"><svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/></svg></button>
    {children}
  </li>;
}
