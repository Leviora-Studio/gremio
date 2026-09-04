// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useRef, useState } from "react";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ProtocolGuest, ProtocolGuestCommand, ProtocolGuestFields, ProtocolGuestResult } from "@/lib/protocol-guests";

const emptyFields: ProtocolGuestFields = { name: "", affiliation: "", concern: "" };

export function ProtocolGuestsPanel({ guests, action, onChange, onBusyChange, onDirtyChange, disabled }: {
  guests: ProtocolGuest[];
  action: (command: ProtocolGuestCommand) => Promise<ProtocolGuestResult>;
  onChange: (guests: ProtocolGuest[]) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  disabled: boolean;
}) {
  const [fields, setFields] = useState(emptyFields);
  const [editing, setEditing] = useState<ProtocolGuest | null>(null);
  const [pendingGuest, setPendingGuest] = useState<ProtocolGuest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const baseline = editing ?? emptyFields;
  const dirty = fields.name !== baseline.name || fields.affiliation !== baseline.affiliation || fields.concern !== baseline.concern;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  function reset() { setEditing(null); setFields(emptyFields); }
  function editGuest(guest: ProtocolGuest) { setEditing(guest); setFields({ name: guest.name, affiliation: guest.affiliation, concern: guest.concern }); setError(null); nameInput.current?.focus(); }
  async function change(command: ProtocolGuestCommand): Promise<{ error?: string }> {
    if (locked.current || disabled) return { error: "Bitte die laufende Speicherung abwarten." };
    locked.current = true; setBusy(true); onBusyChange(true); setError(null);
    try {
      const result = await action(command);
      if (result.error || !result.guests) {
        const message = result.error ?? "Speichern konnte nicht bestätigt werden.";
        setError(message); return { error: message };
      }
      onChange(result.guests);
      if (command.type !== "remove" || editing?.id === command.guestId) reset();
      return {};
    } catch {
      const message = "Gästedaten konnten nicht gespeichert werden. Bitte erneut versuchen.";
      setError(message); return { error: message };
    } finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">Diese Gäste gehören nur zu dieser Sitzung. Zugehörigkeit und Anliegen sind optional.</p>
    <form className="space-y-2 rounded-md border bg-white p-3" onSubmit={event => {
      event.preventDefault(); void change(editing ? { type: "update", guestId: editing.id, ...fields } : { type: "add", ...fields });
    }}>
      <label className="block text-xs text-slate-600">Name
        <input ref={nameInput} className="input mt-1" aria-label="Name des Gastes" required maxLength={200} value={fields.name} readOnly={busy} disabled={disabled} onChange={event => setFields(current => ({ ...current, name: event.target.value }))} />
      </label>
      <label className="block text-xs text-slate-600">Zugehörigkeit
        <input className="input mt-1" aria-label="Zugehörigkeit des Gastes" maxLength={300} value={fields.affiliation} readOnly={busy} disabled={disabled} onChange={event => setFields(current => ({ ...current, affiliation: event.target.value }))} />
      </label>
      <label className="block text-xs text-slate-600">Anliegen
        <textarea className="input mt-1 min-h-20 resize-y" aria-label="Anliegen des Gastes" maxLength={1000} value={fields.concern} readOnly={busy} disabled={disabled} onChange={event => setFields(current => ({ ...current, concern: event.target.value }))} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary btn-sm" disabled={disabled || !fields.name.trim() || (!!editing && !dirty)} aria-disabled={busy || disabled}>{editing ? "Änderungen übernehmen" : "Gast hinzufügen"}</button>
        {(editing || dirty) && <button type="button" className="btn-secondary btn-sm" disabled={busy || disabled} onClick={reset}>Abbrechen</button>}
      </div>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <ul className="space-y-2">
      {guests.map(guest => <li key={guest.id} className="space-y-2 rounded-md border bg-white p-3">
        <p className="break-words text-sm font-medium">{guest.name}</p>
        <dl className="space-y-1 break-words text-xs text-slate-600">
          <div><dt className="font-medium">Zugehörigkeit</dt><dd>{guest.affiliation || "—"}</dd></div>
          <div><dt className="font-medium">Anliegen</dt><dd className="whitespace-pre-wrap">{guest.concern || "—"}</dd></div>
        </dl>
        <div className="flex gap-3">
          <button type="button" className="text-xs text-brand-600 hover:underline" disabled={busy || disabled} onClick={() => {
            if (dirty) setPendingGuest(guest); else editGuest(guest);
          }}>Bearbeiten</button>
          <DeleteConfirm disabled={busy || disabled} requireWord={false} buttonLabel="Entfernen" buttonClassName="text-xs text-red-600 hover:underline" title={`Gast „${guest.name}“ entfernen?`} message="Entfernt den Gast nur aus dieser Sitzung. Die aktualisierte Protokolltabelle anschließend in Nextcloud speichern." action={() => change({ type: "remove", guestId: guest.id })} />
        </div>
      </li>)}
    </ul>
    {!guests.length && <p className="rounded border border-dashed p-4 text-sm text-slate-500">Noch keine Gäste eingetragen.</p>}
    <p className="text-xs text-slate-500">Gästedaten mit dem Button übernehmen. Die aktualisierte Tabelle anschließend in Nextcloud speichern.</p>
    <p role="status" className="min-h-4 text-xs text-slate-500">{busy ? "Gästedaten werden gespeichert…" : dirty ? "Gästedaten noch nicht übernommen." : ""}</p>
    <ConfirmDialog open={!!pendingGuest} title="Gästedaten verwerfen?" message="Nicht übernommene Gästedaten verwerfen und einen anderen Gast bearbeiten?" disabled={busy || disabled} onClose={() => setPendingGuest(null)} onConfirm={() => { if (pendingGuest) editGuest(pendingGuest); setPendingGuest(null); }} />
  </div>;
}
