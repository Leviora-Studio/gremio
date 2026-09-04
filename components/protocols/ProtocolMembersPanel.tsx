// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { Select } from "@/components/Select";
import type { ProtocolMember, ProtocolMemberCommand, ProtocolMemberResult } from "@/lib/protocol-members";

export function ProtocolMembersPanel({ members, action, onChange, onBusyChange, disabled }: {
  members: ProtocolMember[];
  action: (command: ProtocolMemberCommand) => Promise<ProtocolMemberResult>;
  onChange: (members: ProtocolMember[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  async function change(command: ProtocolMemberCommand): Promise<{ error?: string }> {
    if (locked.current || disabled) return { error: "Bitte die laufende Speicherung abwarten." };
    locked.current = true;
    setBusy(true); onBusyChange(true); setError(null);
    const previous = members;
    // Commit the visual drop/selection in the same event as the user's gesture.
    // Only one mutation is in flight, so rollback cannot discard a later edit.
    const optimistic = command.type === "reorder"
      ? command.ids.map(id => members.find(member => member.id === id)!)
      : command.type === "attendance"
        ? members.map(member => member.id === command.memberId ? { ...member, present: command.present, proxyMemberId: command.proxyMemberId } : member)
        : null;
    if (optimistic) onChange(optimistic);
    try {
      const result = await action(command);
      if (result.error || !result.members) {
        if (optimistic) onChange(previous);
        const message = result.error ?? "Speichern konnte nicht bestätigt werden.";
        setError(message); return { error: message };
      }
      onChange(result.members);
      if (command.type === "add") setName(current => current === command.name ? "" : current);
      return {};
    } catch {
      if (optimistic) onChange(previous);
      const message = "Mitgliederdaten konnten nicht gespeichert werden. Bitte erneut versuchen.";
      setError(message); return { error: message };
    } finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">Mitglieder und Reihenfolge gelten für den gesamten Protokollbereich. Anwesenheit und Stimmübertragung gelten nur für diese Sitzung.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void change({ type: "add", name }); }}>
      <input className="input min-w-0" aria-label="Name des neuen Mitglieds" placeholder="Mitglied hinzufügen" maxLength={200} required value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
      <button className="btn-secondary btn-sm" disabled={disabled || !name.trim()} aria-disabled={busy || disabled || !name.trim()}>Hinzufügen</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <DndContext id="protocol-members" sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id || busy || disabled) return;
      const from = members.findIndex(member => member.id === active.id);
      const to = members.findIndex(member => member.id === over.id);
      if (from >= 0 && to >= 0) void change({ type: "reorder", ids: arrayMove(members, from, to).map(member => member.id) });
    }}>
      <SortableContext items={members.map(member => member.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {members.map(member => <MemberRow key={member.id} member={member} members={members} disabled={disabled} pending={busy} change={change} />)}
        </div>
      </SortableContext>
    </DndContext>
    {!members.length && <p className="rounded border border-dashed p-4 text-sm text-slate-500">Noch keine Mitglieder eingetragen.</p>}
    <p className="text-xs text-slate-500">Mitgliederdaten werden direkt in Gremio gespeichert. Die Tabelle im Protokoll anschließend in Nextcloud speichern.</p>
    <p role="status" className="min-h-4 text-xs text-slate-500">{busy ? "Mitgliederdaten werden gespeichert…" : ""}</p>
  </div>;
}

function MemberRow({ member, members, disabled, pending, change }: {
  member: ProtocolMember; members: ProtocolMember[]; disabled: boolean; pending: boolean;
  change: (command: ProtocolMemberCommand) => Promise<{ error?: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: member.id, disabled });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rounded-md border bg-white p-3 ${isDragging ? "relative z-10 shadow-lg" : ""}`}>
    <div className="flex items-start gap-2">
      <button type="button" {...attributes} {...(pending ? {} : listeners)} disabled={disabled} aria-disabled={disabled || pending} aria-label={`${member.name} verschieben`} title="Ziehen zum Sortieren; mit Leertaste und Pfeiltasten bedienbar" className="cursor-grab touch-none px-1 text-slate-500 active:cursor-grabbing">⠿</button>
      <label className="flex min-w-0 flex-1 items-start gap-2 text-sm font-medium">
        <input type="checkbox" className="mt-1" checked={member.present} disabled={disabled} aria-disabled={disabled || pending} onChange={event => { if (!pending) void change({ type: "attendance", memberId: member.id, present: event.target.checked, proxyMemberId: member.proxyMemberId }); }} />
        <span className="break-words">{member.name}<span className="block text-xs font-normal text-slate-500">{member.present ? "Anwesend" : "Nicht anwesend"}</span></span>
      </label>
      <DeleteConfirm disabled={disabled || pending} requireWord={false} buttonLabel="Entfernen" buttonClassName="text-xs text-red-600 hover:underline" title={`Mitglied „${member.name}“ entfernen?`} message="Entfernt das Mitglied aus diesem Protokollbereich und seine Anwesenheits- und Übertragungsdaten aus allen Sitzungen. Bereits in Nextcloud gespeicherte Protokolle werden dadurch nicht automatisch geändert." action={() => change({ type: "remove", memberId: member.id })} />
    </div>
    <label className="mt-2 block text-xs text-slate-600">Stimme übertragen auf
      <Select portal className="mt-1" ariaLabel={`Stimme von ${member.name} übertragen auf`} disabled={disabled || pending} value={String(member.proxyMemberId ?? "")} onChange={value => { if (!pending) void change({ type: "attendance", memberId: member.id, present: member.present, proxyMemberId: value ? Number(value) : null }); }} options={[{ value: "", label: "Keine Übertragung" }, ...members.filter(other => other.id !== member.id).map(other => ({ value: String(other.id), label: other.name }))]} />
    </label>
  </div>;
}
