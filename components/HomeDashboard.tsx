// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveTaskPrefsAction } from "@/app/intern/aufgaben/actions";
import { HOME_SECTIONS, type HomePref, type HomeSectionKey } from "@/lib/home-dashboard";

function SortableHomeSection({ sectionKey, label, checked, onToggle }: {
  sectionKey: HomeSectionKey; label: string; checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sectionKey });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 ${isDragging ? "z-10 border-brand-300 shadow-md" : "border-slate-200"}`}>
    <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none rounded px-1 text-slate-400 hover:text-slate-700 active:cursor-grabbing" aria-label={`${label} verschieben`} title="Ziehen zum Sortieren">⠿</button>
    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event => onToggle(event.target.checked)} className="h-4 w-4" /><span>{label}</span></label>
  </div>;
}

/**
 * Startseite mit frei wähl- und sortierbaren Abschnitten.
 * Ein-/Ausblenden und Sortieren wirken sofort (Client-State) und werden im Hintergrund
 * gespeichert (atomarer JSONB-Merge → stört die Aufgaben-Settings nicht).
 */
export function HomeDashboard({
  home: initial,
  tasks,
  boards,
  finances,
  inventories,
  protocols,
}: {
  home: HomePref;
  tasks: ReactNode;
  boards: ReactNode;
  finances: ReactNode;
  inventories: ReactNode;
  protocols: ReactNode;
}) {
  const [home, setHome] = useState<HomePref>(initial);
  const [showSettings, setShowSettings] = useState(false);
  const first = useRef(true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveTaskPrefsAction({ home }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [home]);

  const noneVisible = HOME_SECTIONS.every(section => !home[section.key]);
  const nodes: Record<HomeSectionKey, ReactNode> = { tasks, boards, protocols, finances, inventories };
  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    setHome(current => {
      const from = current.order.indexOf(event.active.id as HomeSectionKey); const to = current.order.indexOf(event.over!.id as HomeSectionKey);
      return from < 0 || to < 0 ? current : { ...current, order: arrayMove(current.order, from, to) };
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Startseite</h1>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="btn-secondary"
        >
          ⚙ Startseite anpassen
        </button>
      </div>

      {showSettings && (
        <div className="card p-4">
          <p className="mb-3 text-sm text-slate-600">
            Wähle die sichtbaren Bereiche und lege ihre Reihenfolge fest.
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
            <SortableContext items={home.order} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {home.order.map(key => {
                  const section = HOME_SECTIONS.find(item => item.key === key)!;
                  return <SortableHomeSection key={key} sectionKey={key} label={section.label} checked={home[key]} onToggle={checked => setHome(current => ({ ...current, [key]: checked }))} />;
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {home.order.map(key => home[key] && <section key={key} data-home-section={key}>{nodes[key]}</section>)}

      {noneVisible && (
        <div className="card p-8 text-center text-slate-500">
          Keine Bereiche ausgewählt — über „Startseite anpassen" wieder
          einblenden.
        </div>
      )}
    </div>
  );
}
