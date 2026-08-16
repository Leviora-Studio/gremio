// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatCents } from "@/lib/money";
import { todayInBerlin } from "@/lib/dates";
import { priorityBadgeClass } from "@/lib/constants";
import { saveTaskPrefsAction, type TaskPrefs } from "@/app/intern/aufgaben/actions";
import type { TaskCardRow } from "@/lib/task-overview-data";

export type { TaskCardRow };

type Board = { id: number; name: string };
type Status = { id: number; name: string };
type Priority = { id: number; label: string; color: string };

const OVERVIEW_FIELDS: { key: string; label: string }[] = [
  { key: "number", label: "Antragsnr." },
  { key: "applicant", label: "Antragsteller" },
  { key: "priority", label: "Priorität" },
  { key: "deadline", label: "Deadline" },
  { key: "meeting", label: "Sitzung" },
  { key: "budget_title", label: "Haushaltstitel" },
  { key: "account", label: "Konto" },
  { key: "approved_amount", label: "Genehmigt" },
  { key: "actual_amount", label: "Getätigt" },
  { key: "notes", label: "Notizen" },
];
const DEFAULT_FIELDS = ["priority", "deadline"];
const ALL_FIELD_KEYS = OVERVIEW_FIELDS.map((f) => f.key);

type EffPref = { enabled: boolean; excludedStatusIds: number[]; fields: string[] };

function effPref(prefs: TaskPrefs, boardId: number): EffPref {
  const p = prefs.boards?.[String(boardId)];
  return {
    enabled: p?.enabled !== false,
    excludedStatusIds: p?.excludedStatusIds ?? [],
    fields: p?.fields ?? DEFAULT_FIELDS,
  };
}

export function TaskOverview({
  cards,
  boards,
  statusesByBoard,
  priorities,
  prefs: initialPrefs,
}: {
  cards: TaskCardRow[];
  boards: Board[];
  statusesByBoard: Record<number, Status[]>;
  priorities: Priority[];
  prefs: TaskPrefs;
}) {
  // Lokaler Zustand nur für die eigenen Schlüssel (boards/boardOrder) — home
  // gehört dem HomeDashboard und wird per JSONB-Merge unangetastet gelassen.
  const [prefs, setPrefs] = useState<TaskPrefs>(() => ({
    boards: initialPrefs?.boards,
    boardOrder: initialPrefs?.boardOrder,
  }));
  const [showSettings, setShowSettings] = useState(false);
  const prioById = new Map(priorities.map((p) => [p.id, p]));
  const today = todayInBerlin();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Board-Reihenfolge: erst die per Drag bestimmte, dann neue/unsortierte hinten.
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const order = prefs.boardOrder ?? [];
  const orderedBoards: Board[] = [
    ...order.map((id) => boardById.get(id)).filter((b): b is Board => !!b),
    ...boards.filter((b) => !order.includes(b.id)),
  ];

  // Hintergrund-Speichern (debounced), ohne Reload.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveTaskPrefsAction(prefs).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [prefs]);

  const setBoard = (boardId: number, next: EffPref) =>
    setPrefs((prev) => ({
      ...prev,
      boards: { ...(prev.boards ?? {}), [String(boardId)]: next },
    }));

  const onBoardDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = orderedBoards.map((b) => b.id);
    const oldIndex = ids.indexOf(Number(active.id));
    const newIndex = ids.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setPrefs((prev) => ({ ...prev, boardOrder: arrayMove(ids, oldIndex, newIndex) }));
  };

  // Innerhalb eines Boards nach Deadline (früheste zuerst), dann Spalte.
  const byDeadline = (a: TaskCardRow, b: TaskCardRow) => {
    if (a.deadline && b.deadline && a.deadline !== b.deadline)
      return a.deadline < b.deadline ? -1 : 1;
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    return 0;
  };

  const filtered = cards.filter((c) => {
    const bp = effPref(prefs, c.boardId);
    return bp.enabled && !bp.excludedStatusIds.includes(c.statusId);
  });
  // Immer nach Board gruppiert (Reihenfolge über „Anzeige anpassen" per Drag).
  const boardGroups = orderedBoards
    .map((b) => ({
      board: b,
      items: filtered
        .filter((c) => c.boardId === b.id)
        .sort((x, y) => byDeadline(x, y) || x.statusPosition - y.statusPosition),
    }))
    .filter((g) => g.items.length > 0);

  function renderCard(c: TaskCardRow) {
    const fields = effPref(prefs, c.boardId).fields;
    const has = (k: string) => fields.includes(k);
    const overdue = c.deadline != null && c.deadline < today;
    const prio = c.priorityId != null ? prioById.get(c.priorityId) : null;
    return (
      <Link
        key={c.id}
        href={`/intern/card/${c.id}`}
        className="block rounded-md border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:bg-brand-50/40"
      >
        <p className="truncate font-medium text-slate-800">
          {has("number") && c.number ? (
            <span className="text-slate-400">{c.number} · </span>
          ) : null}
          {c.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-brand-100 px-1.5 py-0.5 font-medium text-brand-700">
            {c.boardName}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
            {c.statusName}
          </span>
          {has("priority") && prio && (
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${priorityBadgeClass(prio.color)}`}
            >
              {prio.label}
            </span>
          )}
          {has("deadline") && c.deadline && (
            <span
              className={`rounded px-1.5 py-0.5 ${
                overdue
                  ? "bg-red-100 font-medium text-red-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              ⏱ {c.deadline}
            </span>
          )}
          {has("meeting") && c.meeting && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
              🗓 {c.meeting}
            </span>
          )}
          {has("applicant") && c.applicant && (
            <span className="text-slate-500">{c.applicant}</span>
          )}
          {has("budget_title") && c.budgetTitle && (
            <span className="text-slate-500">HHT {c.budgetTitle}</span>
          )}
          {has("account") && c.accountName && (
            <span className="text-slate-500">{c.accountName}</span>
          )}
          {has("approved_amount") && c.approvedAmount != null && (
            <span className="text-slate-500">gen. {formatCents(c.approvedAmount)}</span>
          )}
          {has("actual_amount") && c.actualAmount != null && (
            <span className="text-slate-500">getät. {formatCents(c.actualAmount)}</span>
          )}
        </div>
        {has("notes") && c.notes && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.notes}</p>
        )}
      </Link>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Meine Aufgaben</h2>
          <p className="text-sm text-slate-500">
            {filtered.length} von {cards.length} mir zugewiesenen Karten
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="btn-secondary"
        >
          ⚙ Anzeige anpassen
        </button>
      </div>

      {showSettings && (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Wähle, welche Boards einbezogen werden, und ziehe sie am{" "}
            <span className="font-mono">⠿</span> in deine{" "}
            <strong>Wunschreihenfolge</strong> (gilt für „Sortieren: Board").{" "}
            <strong>Klicke ein Board</strong>, um Spalten &amp; Felder zu wählen.
          </p>
          <DndContext
            id="dnd-task-overview"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onBoardDragEnd}
          >
            <SortableContext
              items={orderedBoards.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {orderedBoards.map((b) => (
                  <SortableBoardRow
                    key={b.id}
                    board={b}
                    bp={effPref(prefs, b.id)}
                    statuses={statusesByBoard[b.id] ?? []}
                    onChange={(next) => setBoard(b.id, next)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          {cards.length === 0
            ? "Dir sind aktuell keine Karten zugewiesen."
            : "Keine Karten passen zu deiner Auswahl (Einstellungen anpassen)."}
        </div>
      ) : (
        <div className="space-y-5">
          {boardGroups.map((g) => (
            <div key={g.board.id} className="space-y-2">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-1">
                <span className="rounded bg-brand-100 px-2 py-0.5 text-sm font-semibold text-brand-700">
                  {g.board.name}
                </span>
                <span className="text-xs text-slate-400">{g.items.length}</span>
              </div>
              {g.items.map(renderCard)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableBoardRow({
  board,
  bp,
  statuses,
  onChange,
}: {
  board: Board;
  bp: EffPref;
  statuses: Status[];
  onChange: (next: EffPref) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: board.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-slate-200 bg-white ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      <details className="collapsible">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-slate-50">
          <span
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab select-none text-slate-400 active:cursor-grabbing"
            title="Ziehen zum Sortieren"
            aria-label="Board sortieren"
          >
            ⠿
          </span>
          <input
            type="checkbox"
            checked={bp.enabled}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ ...bp, enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <span className="flex-1">{board.name}</span>
          {bp.enabled && (
            <span className="text-xs font-normal text-brand-600">
              Spalten &amp; Felder
            </span>
          )}
          <span className="chev text-slate-400 transition-transform" aria-hidden>
            ▾
          </span>
        </summary>
        {bp.enabled && (
          <div className="space-y-3 border-t border-slate-100 px-3 py-3">
            <CheckGroup
              title="Spalten"
              onAll={() => onChange({ ...bp, excludedStatusIds: [] })}
              onNone={() =>
                onChange({ ...bp, excludedStatusIds: statuses.map((s) => s.id) })
              }
              items={statuses.map((s) => ({
                key: String(s.id),
                label: s.name,
                checked: !bp.excludedStatusIds.includes(s.id),
                onToggle: (on) => {
                  const ex = new Set(bp.excludedStatusIds);
                  if (on) ex.delete(s.id);
                  else ex.add(s.id);
                  onChange({ ...bp, excludedStatusIds: [...ex] });
                },
              }))}
            />
            <CheckGroup
              title="Felder auf der Übersicht"
              onAll={() => onChange({ ...bp, fields: [...ALL_FIELD_KEYS] })}
              onNone={() => onChange({ ...bp, fields: [] })}
              items={OVERVIEW_FIELDS.map((f) => ({
                key: f.key,
                label: f.label,
                checked: bp.fields.includes(f.key),
                onToggle: (on) => {
                  const set = new Set(bp.fields);
                  if (on) set.add(f.key);
                  else set.delete(f.key);
                  onChange({ ...bp, fields: [...set] });
                },
              }))}
            />
          </div>
        )}
      </details>
    </div>
  );
}

function CheckGroup({
  title,
  items,
  onAll,
  onNone,
}: {
  title: string;
  items: { key: string; label: string; checked: boolean; onToggle: (on: boolean) => void }[];
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase text-slate-400">{title}</p>
        <button
          type="button"
          className="text-xs text-brand-600 hover:underline"
          onClick={onAll}
        >
          alle
        </button>
        <span className="text-xs text-slate-300">·</span>
        <button
          type="button"
          className="text-xs text-slate-500 hover:underline"
          onClick={onNone}
        >
          keine
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((it) => (
          <label key={it.key} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={it.checked}
              onChange={(e) => it.onToggle(e.target.checked)}
            />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}
