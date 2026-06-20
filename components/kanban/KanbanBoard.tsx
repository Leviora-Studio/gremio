// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { clsx } from "clsx";
import { moveCardAction } from "@/app/intern/board/actions";
import { priorityBadgeClass } from "@/lib/constants";
import { todayInBerlin } from "@/lib/dates";
import type { PriorityOption } from "@/lib/priorities";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";

type PriorityMap = Record<number, { label: string; color: string }>;

export type KanbanCard = {
  id: number;
  statusId: number;
  title: string;
  number: string | null;
  applicant: string;
  priorityId: number | null;
  resubmitted: boolean;
  deadline: string | null;
  meeting: string | null;
  assignees: { id: number; name: string; avatarPath: string | null }[];
  searchText: string; // serverseitig: alle durchsuchbaren Felder, lowercase
};

type StatusCol = { id: number; name: string; isArchiveTrigger: boolean };
type Member = {
  id: number;
  username: string;
  name: string | null;
  avatarPath: string | null;
};

function buildCols(
  statuses: StatusCol[],
  cards: KanbanCard[],
): Record<number, number[]> {
  const map: Record<number, number[]> = {};
  for (const s of statuses) map[s.id] = [];
  for (const c of cards) (map[c.statusId] ??= []).push(c.id);
  return map;
}

export function KanbanBoard({
  statuses,
  cards,
  visible,
  priorities,
  members,
}: {
  statuses: StatusCol[];
  cards: KanbanCard[];
  visible: string[];
  priorities: PriorityOption[];
  members: Member[];
}) {
  const router = useRouter();
  const priorityMap: PriorityMap = Object.fromEntries(
    priorities.map((p) => [p.id, { label: p.label, color: p.color }]),
  );

  const [cardById, setCardById] = useState<Map<number, KanbanCard>>(
    () => new Map(cards.map((c) => [c.id, c])),
  );
  const [cols, setCols] = useState<Record<number, number[]>>(() =>
    buildCols(statuses, cards),
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const justDragged = useRef(false);
  const dragging = useRef(false);

  // Filter (rein clientseitig)
  const [q, setQ] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fAssignee, setFAssignee] = useState(""); // "" | "none" | userId
  const [fOverdue, setFOverdue] = useState(false);

  // Server-Daten übernehmen, NUR wenn sich die cards-Prop wirklich ändert
  // (neue Karte, Reload, persistierte Reihenfolge). Nicht an activeId koppeln:
  // sonst würde der Effekt beim Loslassen mit noch-alten Daten laufen und die
  // optimistische Reihenfolge kurz auf den Ausgangszustand zurücksetzen.
  useEffect(() => {
    if (dragging.current) return;
    setCardById(new Map(cards.map((c) => [c.id, c])));
    setCols(buildCols(statuses, cards));
  }, [cards, statuses]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const visibleSet = new Set(visible);
  const today = todayInBerlin();

  const showPriorityFilter = visibleSet.has("priority");
  const showAssigneeFilter = visibleSet.has("assignee");
  const showOverdueFilter = visibleSet.has("deadline");
  const filtersActive =
    q.trim() !== "" || fPriority !== "" || fAssignee !== "" || fOverdue;

  function matches(card: KanbanCard): boolean {
    if (q.trim()) {
      // Über ALLE Felder suchen (serverseitig vorberechneter searchText).
      if (!card.searchText.includes(q.trim().toLowerCase())) return false;
    }
    if (fPriority && String(card.priorityId ?? "") !== fPriority) return false;
    if (fAssignee) {
      if (fAssignee === "none") {
        if (card.assignees.length > 0) return false;
      } else if (!card.assignees.some((a) => String(a.id) === fAssignee))
        return false;
    }
    if (fOverdue) {
      if (!card.deadline || card.deadline >= today) return false;
    }
    return true;
  }

  // Eigene Kollisionserkennung: zuerst pointer-basiert (was liegt direkt unter
  // dem Cursor?). Das macht auch LEERE, hohe Spalten zuverlässig als Ziel
  // erkennbar — closestCorners verfehlte sie, weil ihre Ecken weit vom Cursor
  // entfernt sind. Liegt der Cursor über einer Karte → diese (präzises
  // Einsortieren); liegt er nur über dem leeren Spaltenbereich → die Spalte
  // (ans Ende). Fallback: rectIntersection.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const card = pointer.find((c) => typeof c.id === "number");
      if (card) return [card];
      const col = pointer.find(
        (c) => typeof c.id === "string" && String(c.id).startsWith("col-"),
      );
      if (col) return [col];
      return [pointer[0]];
    }
    const rect = rectIntersection(args);
    const overId = getFirstCollision(rect, "id");
    return overId != null ? [{ id: overId }] : [];
  };

  function containerOfCard(id: number): number | null {
    for (const s of statuses) if (cols[s.id]?.includes(id)) return s.id;
    return null;
  }
  function containerOf(overId: UniqueIdentifier | undefined): number | null {
    if (overId == null) return null;
    if (typeof overId === "string" && overId.startsWith("col-")) {
      return Number(overId.slice(4));
    }
    return containerOfCard(Number(overId));
  }

  function onDragStart(e: DragStartEvent) {
    justDragged.current = true;
    dragging.current = true;
    setActiveId(Number(e.active.id));
  }

  // Live während des Ziehens umsortieren — sowohl innerhalb einer Spalte als
  // auch zwischen Spalten. So sitzt die Karte beim Loslassen bereits richtig
  // und springt nicht.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const aId = Number(active.id);
    const from = containerOfCard(aId);
    const to = containerOf(over.id);
    if (from == null || to == null) return;

    setCols((prev) => {
      const fromItems = prev[from] ?? [];
      const toItems = prev[to] ?? [];

      if (from === to) {
        // gleiche Spalte: nur über einer anderen Karte neu anordnen
        if (typeof over.id === "string") return prev;
        const oldIndex = fromItems.indexOf(aId);
        const overIndex = fromItems.indexOf(Number(over.id));
        if (oldIndex < 0 || overIndex < 0 || oldIndex === overIndex) return prev;
        return { ...prev, [to]: arrayMove(fromItems, oldIndex, overIndex) };
      }

      // andere Spalte: an Zielposition einfügen
      let idx = toItems.length;
      if (typeof over.id !== "string") {
        const oi = toItems.indexOf(Number(over.id));
        if (oi >= 0) idx = oi;
      }
      return {
        ...prev,
        [from]: fromItems.filter((x) => x !== aId),
        [to]: [...toItems.slice(0, idx), aId, ...toItems.slice(idx)],
      };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active } = e;
    dragging.current = false;
    setActiveId(null);
    setTimeout(() => {
      justDragged.current = false;
    }, 60);
    const aId = Number(active.id);
    // onDragOver hat bereits live umsortiert → aktuelle Spalte/Reihenfolge übernehmen.
    const to = containerOfCard(aId);
    if (to == null) return;

    const card = cardById.get(aId);
    if (card && card.statusId !== to) {
      const next = new Map(cardById);
      next.set(aId, { ...card, statusId: to });
      setCardById(next);
    }

    void moveCardAction(aId, to, cols[to] ?? []);
  }

  function openCard(id: number) {
    if (justDragged.current) return;
    router.push(`/intern/card/${id}`);
  }

  const activeCard = activeId != null ? cardById.get(activeId) ?? null : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-56">
          <label className="label">Suche</label>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Alle Felder durchsuchen …"
          />
        </div>
        {showAssigneeFilter && (
          <div className="w-48">
            <label className="label">Zugewiesen</label>
            <Select
              value={fAssignee}
              onChange={setFAssignee}
              options={[
                { value: "", label: "Alle" },
                { value: "none", label: "Niemand" },
                ...members.map((m) => ({
                  value: String(m.id),
                  label: m.name || m.username,
                })),
              ]}
            />
          </div>
        )}
        {showPriorityFilter && (
          <div className="w-40">
            <label className="label">Priorität</label>
            <Select
              value={fPriority}
              onChange={setFPriority}
              options={[
                { value: "", label: "Alle" },
                ...priorities.map((p) => ({
                  value: String(p.id),
                  label: p.label,
                })),
              ]}
            />
          </div>
        )}
        {showOverdueFilter && (
          <label className="btn-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              className="mr-2"
              checked={fOverdue}
              onChange={(e) => setFOverdue(e.target.checked)}
            />
            Nur überfällig
          </label>
        )}
        {filtersActive && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQ("");
              setFPriority("");
              setFAssignee("");
              setFOverdue(false);
            }}
          >
            Zurücksetzen
          </button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          dragging.current = false;
          setActiveId(null);
        }}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {statuses.map((st) => {
            const ids = (cols[st.id] ?? []).filter((id) => {
              const c = cardById.get(id);
              return c && matches(c);
            });
            return (
              <Column
                key={st.id}
                status={st}
                cardIds={ids}
                cardById={cardById}
                visibleSet={visibleSet}
                priorityMap={priorityMap}
                onOpen={openCard}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <CardView
              card={activeCard}
              visibleSet={visibleSet}
              priorityMap={priorityMap}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  status,
  cardIds,
  cardById,
  visibleSet,
  priorityMap,
  onOpen,
}: {
  status: StatusCol;
  cardIds: number[];
  cardById: Map<number, KanbanCard>;
  visibleSet: Set<string>;
  priorityMap: PriorityMap;
  onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status.id}` });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex w-80 shrink-0 flex-col rounded-lg border bg-slate-100/60 p-2",
        isOver ? "border-brand-400 bg-brand-50" : "border-slate-200",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-slate-700">{status.name}</h3>
        <span className="rounded bg-slate-200 px-1.5 text-xs text-slate-600">
          {cardIds.length}
        </span>
      </div>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[60px] flex-1 flex-col gap-2">
          {cardIds.map((id) => {
            const c = cardById.get(id);
            return c ? (
              <SortableCard
                key={id}
                card={c}
                visibleSet={visibleSet}
                priorityMap={priorityMap}
                onOpen={onOpen}
              />
            ) : null;
          })}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({
  card,
  visibleSet,
  priorityMap,
  onOpen,
}: {
  card: KanbanCard;
  visibleSet: Set<string>;
  priorityMap: PriorityMap;
  onOpen: (id: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      className={clsx(
        "cursor-grab touch-none rounded-md border p-3 shadow-sm active:cursor-grabbing",
        card.resubmitted
          ? "border-amber-400 bg-amber-50 hover:border-amber-500"
          : "border-slate-200 bg-white hover:border-brand-300",
        isDragging && "opacity-40",
      )}
    >
      <CardView card={card} visibleSet={visibleSet} priorityMap={priorityMap} />
    </div>
  );
}

function CardView({
  card,
  visibleSet,
  priorityMap,
  dragging,
}: {
  card: KanbanCard;
  visibleSet: Set<string>;
  priorityMap: PriorityMap;
  dragging?: boolean;
}) {
  const prio =
    card.priorityId != null ? priorityMap[card.priorityId] : undefined;
  const overdue =
    card.deadline != null && card.deadline < todayInBerlin();
  return (
    <div
      className={clsx(
        dragging &&
          "cursor-grabbing rounded-md border border-slate-200 bg-white p-3 shadow-lg ring-2 ring-brand-400",
      )}
    >
      {visibleSet.has("number") && card.number && (
        <div className="text-xs font-semibold text-brand-600">{card.number}</div>
      )}
      <div className="text-sm font-medium text-slate-800">{card.title}</div>
      {visibleSet.has("applicant") && card.applicant && (
        <div className="text-xs text-slate-500">{card.applicant}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.resubmitted && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            ● Nachgereicht
          </span>
        )}
        {visibleSet.has("priority") && prio && (
          <span
            className={clsx(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              priorityBadgeClass(prio.color),
            )}
          >
            {prio.label}
          </span>
        )}
        {visibleSet.has("deadline") && card.deadline && (
          <span
            className={clsx(
              "rounded px-1.5 py-0.5 text-xs",
              overdue
                ? "bg-red-100 font-medium text-red-700"
                : "bg-slate-100 text-slate-600",
            )}
          >
            ⏱ {card.deadline}
          </span>
        )}
        {visibleSet.has("meeting") && card.meeting && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            📅 {card.meeting}
          </span>
        )}
        {visibleSet.has("assignee") &&
          card.assignees.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700"
            >
              <Avatar
                username={a.name}
                src={a.avatarPath ? `/api/avatar/${a.id}` : null}
                size={16}
              />
              {a.name}
            </span>
          ))}
      </div>
    </div>
  );
}
