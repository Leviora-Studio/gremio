// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { hasOpenCashbookFlag, type CashbookPayment } from "@/lib/cashbook-types";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

const columns = [
  { key: "bookingNumber", label: "Buchungsnummer" },
  { key: "number", label: "Antrags-/G-Nummer" },
  { key: "holder", label: "Kontoinhaber" },
  { key: "amount", label: "Betrag" },
  { key: "budgetTitle", label: "Haushaltstitel" },
  { key: "iban", label: "IBAN" },
  { key: "bank", label: "Bank" },
  { key: "purpose", label: "Verwendungszweck" },
  { key: "authorizedAt", label: "Anweisung erteilt" },
  { key: "bookingDate", label: "Buchungstag" },
  { key: "correction", label: "Korrektur" },
] as const;
type ColumnKey = typeof columns[number]["key"];
type LedgerView = { order: ColumnKey[]; hidden: ColumnKey[]; sort: { key: ColumnKey; direction: 1 | -1 } };
const isColumnKey = (key: unknown): key is ColumnKey => columns.some(column => column.key === key);
const defaultView = (): LedgerView => ({ order: columns.map(column => column.key), hidden: [], sort: { key: "authorizedAt", direction: -1 } });

export type LedgerRow = {
  bookingNumber: string | null;
  flaggedAt: string | null;
  flagResolvedAt: string | null;
  id: number;
  data: CashbookPayment;
  authorizedAt: string | null;
  bookingDate: string | null;
  correctsId: number | null;
};

function cellValue(row: LedgerRow, key: ColumnKey): string | number {
  if (key === "bookingNumber") return row.bookingNumber ?? "";
  if (key === "correction") return row.correctsId ? `Korrektur zu #${row.correctsId}` : "Original";
  if (key === "authorizedAt") return row.authorizedAt ?? "";
  if (key === "bookingDate") return row.bookingDate ?? "";
  return row.data[key];
}

function displayValue(row: LedgerRow, key: ColumnKey): string {
  if (key === "amount") return formatCents(row.data.amount);
  if (key === "authorizedAt") return row.authorizedAt ? formatDateTime(row.authorizedAt, "medium") : "—";
  if (key === "bookingDate") return row.bookingDate ? row.bookingDate.split("-").reverse().join(".") : "—";
  if (key === "iban") return row.data.iban.replace(/\s/g, "").replace(/(.{4})(?=.)/g, "$1 ");
  return String(cellValue(row, key) || "—");
}

function columnWidth(key: ColumnKey) {
  if (key === "purpose") return "min-w-56 max-w-sm whitespace-normal break-words";
  if (key === "holder" || key === "bank") return "min-w-40 max-w-64 whitespace-normal break-words";
  return "whitespace-nowrap";
}

function SortableLedgerColumn({ columnKey, label, checked, onToggle }: {
  columnKey: ColumnKey; label: string; checked: boolean; onToggle: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey });
  return <li ref={setNodeRef} data-live-refresh-block={isDragging}
    style={{ transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : undefined }}
    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isDragging ? "border-brand-300 bg-brand-50 shadow-md" : "border-slate-200 bg-white"}`}
  >
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`${label} verschieben`}
      className="flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500 active:cursor-grabbing"
    >
      <svg aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/></svg>
    </button>
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600" checked={checked} onChange={event => onToggle(event.target.checked)}/><span>{label}</span></label>
  </li>;
}

export function LedgerTable({ bookId, rows, userId }: { bookId: number; rows: LedgerRow[]; userId: number }) {
  const router = useRouter();
  const storageKey = `cashbook-view-${userId}-${bookId}`;
  const [view, setView] = useState<LedgerView>(defaultView);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const columnSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let next = defaultView();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object") {
        const order: ColumnKey[] = Array.isArray(saved.order) ? [...new Set(saved.order.filter(isColumnKey) as ColumnKey[])] : [];
        next = {
          order: [...order, ...columns.map(column => column.key).filter(key => !order.includes(key))],
          hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(isColumnKey) : [],
          sort: isColumnKey(saved.sort?.key) ? { key: saved.sort.key, direction: saved.sort.direction === 1 ? 1 : -1 } : next.sort,
        };
      }
    } catch { /* Keep the default view when local preferences are unavailable. */ }
    setView(next);
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(view)); } catch { /* Viewing remains available without local storage. */ }
  }, [view, loadedKey, storageKey]);

  const visible = view.order.filter(key => !view.hidden.includes(key));
  const sorted = [...rows].sort((a, b) => {
    const x = cellValue(a, view.sort.key), y = cellValue(b, view.sort.key);
    // Empty values remain at the end in either direction.
    if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
    const comparison = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de", { numeric: true });
    return view.sort.direction * comparison || a.id - b.id;
  });
  const sortLabel = columns.find(column => column.key === view.sort.key)!.label;

  function sortBy(key: ColumnKey) {
    setView(current => ({ ...current, sort: { key, direction: current.sort.key === key && current.sort.direction === 1 ? -1 : 1 } }));
  }
  function moveColumn({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setView(current => {
      const from = current.order.indexOf(active.id as ColumnKey);
      const to = current.order.indexOf(over.id as ColumnKey);
      return from < 0 || to < 0 ? current : { ...current, order: arrayMove(current.order, from, to) };
    });
  }

  return <section className="card min-w-0 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <h2 className="text-lg font-semibold">Gebuchte Anweisungen</h2>
        <p className="mt-1 text-sm text-slate-500">{rows.length} {rows.length === 1 ? "Buchung" : "Buchungen"}</p>
      </div>
      <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(true)}>Ansicht einstellen</button>
    </div>
    <div className="border-y border-slate-100 bg-slate-50/50 px-5 py-2.5 text-xs text-slate-500" aria-live="polite">
      Sortiert nach <span className="font-medium text-slate-700">{sortLabel}</span>, {view.sort.direction === 1 ? "aufsteigend" : "absteigend"}
    </div>
    {visible.length ? <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Gebuchte Anweisungen. Spaltenüberschriften anklicken, um die Sortierung zu ändern.</caption>
        <thead className="bg-slate-50/50">
          <tr>{visible.map(key => <th key={key} scope="col"
            aria-sort={view.sort.key === key ? view.sort.direction === 1 ? "ascending" : "descending" : "none"}
            className={`border-b border-slate-200 px-5 py-3 font-medium ${key === "amount" ? "text-right" : "text-left"}`}
          >
            <button type="button" onClick={() => sortBy(key)}
              aria-label={`${columns.find(column => column.key === key)!.label} sortieren`}
              className={`whitespace-nowrap rounded-sm outline-none hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-brand-500 ${view.sort.key === key ? "text-slate-900" : "text-slate-500"}`}
            >{columns.find(column => column.key === key)!.label}</button>
          </th>)}</tr>
        </thead>
        <tbody>{sorted.map(row => <tr key={row.id}
          onClick={event => {
            if ((event.target as HTMLElement).closest("a") || window.getSelection()?.toString()) return;
            const href = `/intern/kassenbuch/vorgang/${row.id}`;
            if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener,noreferrer");
            else router.push(href);
          }}
          className={`cursor-pointer outline-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-brand-500 ${hasOpenCashbookFlag(row) ? "bg-red-50 text-red-900 hover:bg-red-100" : "text-slate-700 hover:bg-slate-50"}`}
        >
          {visible.map(key => <td key={key} className={`border-b border-slate-100 px-5 py-4 align-top last:border-b-slate-100 ${columnWidth(key)} ${key === "amount" ? "text-right font-medium tabular-nums" : ""} ${key === "bookingNumber" ? "font-medium text-slate-950" : ""} ${key === "iban" ? "text-xs tabular-nums" : ""}`}>
            {hasOpenCashbookFlag(row) && key === visible[0] && <span className="mb-1 block text-xs font-semibold text-red-800">Als falsch markiert</span>}
            {key === visible[0] ? <Link href={`/intern/kassenbuch/vorgang/${row.id}`} aria-label={`Vorgang ${row.bookingNumber ?? row.data.number} öffnen`} className="block text-inherit no-underline outline-none hover:no-underline">{displayValue(row, key)}</Link> : <span>{displayValue(row, key)}</span>}
          </td>)}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="px-5 py-8 text-sm text-slate-500">Noch keine gebuchten Anweisungen.</p>}
    </div> : <div className="space-y-3 px-5 py-8"><p className="text-sm text-slate-500">Alle Spalten sind ausgeblendet.</p><button type="button" className="btn-secondary" onClick={() => setView(current => ({ ...current, hidden: [] }))}>Spalten anzeigen</button></div>}

    <Modal portal manageFocus open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Ansicht einstellen" showCloseButton={false}
      headerActions={<button type="button" className="btn-secondary btn-sm" onClick={() => setSettingsOpen(false)}>Schließen</button>}
    >
      <div className="space-y-6">
        <p className="text-sm text-slate-500">Deine Ansicht wird automatisch gespeichert. Die Buchungsdaten bleiben unverändert.</p>
        <section className="space-y-3">
          <h3 className="font-semibold">Sortierung</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor="ledger-sort-column">Sortieren nach</label><Select id="ledger-sort-column" ariaLabel="Sortieren nach" portal value={view.sort.key} options={columns.map(column => ({ value: column.key, label: column.label }))} onChange={key => { if (isColumnKey(key)) setView(current => ({ ...current, sort: { ...current.sort, key } })); }}/></div>
            <div><label className="label" htmlFor="ledger-sort-direction">Reihenfolge</label><Select id="ledger-sort-direction" ariaLabel="Sortierreihenfolge" portal value={String(view.sort.direction)} options={[{ value: "1", label: "Aufsteigend" }, { value: "-1", label: "Absteigend" }]} onChange={direction => setView(current => ({ ...current, sort: { ...current.sort, direction: direction === "1" ? 1 : -1 } }))}/></div>
          </div>
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Spalten und Reihenfolge</h3><button type="button" className="btn-secondary btn-sm" onClick={() => setView(current => ({ ...current, hidden: [] }))}>Alle anzeigen</button></div>
          <p className="text-sm text-slate-500">{visible.length} von {columns.length} Spalten sichtbar. Ziehe eine Spalte an den sechs Punkten nach oben oder unten, um die Reihenfolge zu ändern.</p>
          <DndContext sensors={columnSensors} collisionDetection={closestCenter} onDragEnd={moveColumn}
            accessibility={{ screenReaderInstructions: { draggable: "Drücke die Leertaste zum Aufnehmen, die Pfeiltasten zum Verschieben und erneut die Leertaste zum Ablegen. Mit Escape abbrechen." } }}
          >
            <SortableContext items={view.order} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2" aria-label="Spaltenreihenfolge">
                {view.order.map(key => <SortableLedgerColumn key={key} columnKey={key}
                  label={columns.find(column => column.key === key)!.label}
                  checked={!view.hidden.includes(key)}
                  onToggle={checked => setView(current => ({ ...current, hidden: checked ? current.hidden.filter(value => value !== key) : [...current.hidden, key] }))}
                />)}
              </ul>
            </SortableContext>
          </DndContext>
        </section>
        <div className="border-t border-slate-200 pt-4"><button type="button" className="btn-secondary" onClick={() => setView(defaultView())}>Standardansicht wiederherstellen</button></div>
      </div>
    </Modal>
  </section>;
}
