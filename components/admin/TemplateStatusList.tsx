// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TemplateStatusRow } from "./TemplateStatusRow";
import { reorderTemplateStatusesAction } from "@/app/vorlagen/boards/actions";

type StatusItem = { id: number; name: string };

export function TemplateStatusList({
  templateId,
  statuses,
}: {
  templateId: number;
  statuses: StatusItem[];
}) {
  const [items, setItems] = useState<StatusItem[]>(statuses);
  const dragging = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (dragging.current) return;
    setItems(statuses);
  }, [statuses]);

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((s) => s.id === Number(active.id));
    const newIndex = items.findIndex((s) => s.id === Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    void reorderTemplateStatusesAction(
      templateId,
      next.map((s) => s.id),
    );
  }

  return (
    <DndContext
      id="dnd-template-statuses"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        dragging.current = false;
      }}
    >
      <SortableContext
        items={items.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">
          {items.map((s) => (
            <TemplateStatusRow key={s.id} templateId={templateId} status={s} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
