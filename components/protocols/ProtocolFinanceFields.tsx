// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useId } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PROTOCOL_FINANCE_LABELS, type ProtocolFinanceField } from "@/lib/protocol-area-config";

export function ProtocolFinanceFields({ fields, onChange, disabled }: { fields: ProtocolFinanceField[]; onChange: (fields: ProtocolFinanceField[]) => void; disabled: boolean }) {
  const id = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (disabled || !over || active.id === over.id) return;
    const from = fields.findIndex(field => field.key === active.id), to = fields.findIndex(field => field.key === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(fields, from, to));
  }}><SortableContext items={fields.map(field => field.key)} strategy={verticalListSortingStrategy}>
    <div className="space-y-1.5">{fields.map(field => <FieldRow key={field.key} field={field} disabled={disabled} onChange={enabled => onChange(fields.map(item => item.key === field.key ? { ...item, enabled } : item))} />)}</div>
  </SortableContext></DndContext>;
}
function FieldRow({ field, disabled, onChange }: { field: ProtocolFinanceField; disabled: boolean; onChange: (enabled: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key, disabled });
  const label = PROTOCOL_FINANCE_LABELS[field.key];
  return <div ref={setNodeRef} data-finance-field={field.key} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 ${isDragging ? "relative z-10 shadow-lg" : ""}`}>
    <button type="button" {...attributes} {...listeners} disabled={disabled} aria-label={`${label} verschieben`} title="Ziehen zum Sortieren; alternativ Leertaste und Pfeiltasten" className="cursor-grab touch-none px-1 text-slate-500 active:cursor-grabbing">⠿</button>
    <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={field.enabled} onChange={event => onChange(event.target.checked)} />{label}</label>
  </div>;
}
