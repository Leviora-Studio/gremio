// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { clsx } from "clsx";

export type BoardCard = {
  id: number;
  name: string;
  description: string | null;
  isOwner: boolean;
};

/** Reiner Karteninhalt (Griff + Link). handleProps werden auf den Griff gelegt. */
function CardContent({
  item,
  hrefBase,
  handleProps,
}: {
  item: BoardCard;
  hrefBase: string;
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <>
      {/* Ganze Karte klickbar: Link als Overlay über die komplette Box. */}
      <Link
        href={`${hrefBase}${item.id}`}
        aria-label={item.name}
        className="absolute inset-0 rounded-lg"
      />
      {/* Griff liegt über dem Link (z-10) und bleibt zieh-/klickbar. */}
      <button
        type="button"
        {...handleProps}
        className="absolute right-2 top-2 z-10 cursor-grab touch-none rounded px-1 text-slate-300 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Zum Sortieren ziehen"
        title="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <h2 className="pr-6 font-semibold text-slate-800">{item.name}</h2>
      {item.description && (
        <p className="mt-1 line-clamp-2 text-sm text-slate-500">
          {item.description}
        </p>
      )}
      {item.isOwner && (
        <span className="mt-2 inline-block rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
          Eigentümer
        </span>
      )}
    </>
  );
}

function SortableCard({
  item,
  hrefBase,
}: {
  item: BoardCard;
  hrefBase: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "card relative p-5 transition-colors hover:border-brand-300",
        isDragging && "opacity-40",
      )}
    >
      <CardContent
        item={item}
        hrefBase={hrefBase}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function SortableBoardGrid({
  boards,
  hrefBase,
  action,
}: {
  boards: BoardCard[];
  hrefBase: string;
  action: (orderedIds: number[]) => Promise<void>;
}) {
  const [items, setItems] = useState<BoardCard[]>(boards);
  const [activeId, setActiveId] = useState<number | null>(null);
  const dragging = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Server-Daten übernehmen (neues/entferntes Board) — nicht während eines Drags.
  useEffect(() => {
    if (!dragging.current) setItems(boards);
  }, [boards]);

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    setActiveId(Number(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false;
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === Number(active.id));
    const newIndex = items.findIndex((i) => i.id === Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    void action(next.map((i) => i.id));
  }

  const activeItem =
    activeId != null ? items.find((i) => i.id === activeId) ?? null : null;

  return (
    <DndContext
      id={`dnd-board-grid-${hrefBase.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        dragging.current = false;
        setActiveId(null);
      }}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={rectSortingStrategy}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <SortableCard key={i.id} item={i} hrefBase={hrefBase} />
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div className="card relative cursor-grabbing p-5 shadow-lg ring-2 ring-brand-400">
            <CardContent item={activeItem} hrefBase={hrefBase} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
