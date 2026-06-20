// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { startTransition, useActionState, useState } from "react";
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
import {
  ATTACHMENT_FIELD_KEYS,
  CARD_FIELD_LABELS,
  type CardFieldKey,
} from "@/lib/constants";
import {
  setCardFieldsAction,
  type State,
} from "@/app/intern/board/[id]/einstellungen/actions";

function FieldRow({
  fieldKey,
  checked,
  onToggle,
}: {
  fieldKey: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: fieldKey });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 ${
        isDragging ? "opacity-60 ring-2 ring-brand-400" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Zum Sortieren ziehen"
        title="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <label className="flex flex-1 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4"
        />
        {CARD_FIELD_LABELS[fieldKey as CardFieldKey]}
      </label>
    </div>
  );
}

export function CardFieldsForm({
  boardId,
  visibility,
  fieldOrder,
}: {
  boardId: number;
  visibility: Record<string, boolean>;
  fieldOrder: string[];
}) {
  const [state, dispatch, pending] = useActionState(
    setCardFieldsAction.bind(null, boardId),
    {} as State,
  );
  const [order, setOrder] = useState<string[]>(fieldOrder);

  // Sichtbarkeit aller (ab-)wählbaren Felder als kontrollierter Zustand.
  const allKeys = [...fieldOrder, ...ATTACHMENT_FIELD_KEYS];
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allKeys.map((k) => [k, visibility[k] ?? true])),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const toggle = (key: string) =>
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  const setAll = (value: boolean) =>
    setChecked((prev) => {
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) next[k] = value;
      return next;
    });

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldI = prev.indexOf(String(active.id));
      const newI = prev.indexOf(String(over.id));
      if (oldI < 0 || newI < 0) return prev;
      return arrayMove(prev, oldI, newI);
    });
  }

  // FormData aus dem Zustand bauen und Action direkt dispatchen — KEIN natives
  // Form-Submit, damit React 19 die kontrollierten Checkboxen nicht zurücksetzt.
  function save() {
    const fd = new FormData();
    fd.set("order", order.join(","));
    for (const key of Object.keys(checked)) {
      if (checked[key]) fd.set(`field_${key}`, "on");
    }
    startTransition(() => dispatch(fd));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAll(true)}
          className="btn-secondary btn-sm"
        >
          Alle auswählen
        </button>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="btn-secondary btn-sm"
        >
          Alle abwählen
        </button>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">
          Felder (zum Sortieren ziehen)
        </p>
        <DndContext
          id="dnd-card-fields"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {order.map((key) => (
                <FieldRow
                  key={key}
                  fieldKey={key}
                  checked={checked[key] ?? true}
                  onToggle={() => toggle(key)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Anhänge</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ATTACHMENT_FIELD_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked[key] ?? true}
                onChange={() => toggle(key)}
                className="h-4 w-4"
              />
              {CARD_FIELD_LABELS[key]}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-primary"
        >
          Kartenfelder speichern
        </button>
        {state.success && (
          <span className="text-sm text-green-600">{state.success}</span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Titel, Erstellungszeitpunkt und Letzte Änderung sind immer sichtbar.
        Aktivierte Felder dürfen leer bleiben. Auf der Karte stehen jeweils zwei
        Felder nebeneinander (auf Handys einspaltig).
      </p>
    </div>
  );
}
