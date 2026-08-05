// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";
import { FileInput } from "@/components/FileInput";
import { submitAntragAction, type SubmitState } from "@/app/actions";

export function PublicAntragForm({
  locations,
  guard,
}: {
  locations: { id: number; name: string }[];
  guard: { ts: string; sig: string };
}) {
  const [state, action, pending] = useActionState(
    submitAntragAction,
    {} as SubmitState,
  );
  // Clientseitig fehlende Pflichtangaben (für eine klare „bitte ergänzen"-Meldung).
  const [missing, setMissing] = useState<string[]>([]);
  const aktuellerGuard = state.guard ?? guard;

  // Bewusst KEIN <form action={action}>: React 19 setzt das Formular nach einer
  // Action zurück und würde dabei v. a. die ausgewählten Dateien verwerfen. Über
  // onSubmit + manuellen Dispatch bleiben alle Eingaben & Dateien erhalten —
  // fehlende Angaben können ergänzt und dann abgesendet werden.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const hasText = (key: string) => String(fd.get(key) ?? "").trim() !== "";
    const hasFile = (key: string) => {
      const v = fd.get(key);
      return v instanceof File && v.size > 0;
    };

    const need: string[] = [];
    if (!hasText("locationId")) need.push("Standort");
    if (!hasText("title")) need.push("Antragsgegenstand");
    if (!hasText("applicant")) need.push("Antragsteller");
    if (!hasFile("finance_request")) need.push("Finanzantrag (PDF)");
    if (!hasFile("student_card")) need.push("Studierendenausweis");

    setMissing(need);
    if (need.length > 0) return; // nichts absenden, nichts verwerfen

    startTransition(() => action(fd));
  }

  // „Danke"-Bestätigung (auch für still verworfene Bot-Einsendungen).
  if (state.ok) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold text-green-700">
          Vielen Dank — dein Antrag wurde übermittelt.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Zeitfalle (signiert). Nach einem abgelaufenen Token liefert die Action
          ein frisches mit — sonst scheiterte der zweite Versuch genauso. */}
      <input type="hidden" name="ts" value={aktuellerGuard.ts} />
      <input type="hidden" name="sig" value={aktuellerGuard.sig} />
      {/* Honeypot: für Menschen unsichtbar, Bots füllen es aus → still verworfen */}
      <div className="absolute left-[-9999px] top-[-9999px]" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <label className="label">Standort *</label>
        <Select
          name="locationId"
          placeholder="Bitte wählen…"
          options={locations.map((l) => ({
            value: String(l.id),
            label: l.name,
          }))}
        />
      </div>

      <div>
        <label htmlFor="ag" className="label">
          Antragsgegenstand *
        </label>
        <input
          id="ag"
          name="title"
          required
          className="input"
          placeholder="z. B. Grillabend am FB5"
        />
      </div>

      <div>
        <label htmlFor="as" className="label">
          Antragsteller *
        </label>
        <input
          id="as"
          name="applicant"
          required
          className="input"
          placeholder="z. B. Max Mustermann"
        />
      </div>

      <div>
        <label className="label">Finanzantrag (PDF) *</label>
        <FileInput name="finance_request" accept="application/pdf,.pdf" />
      </div>

      <div>
        <label className="label">Studierendenausweis (PDF, PNG, JPG) *</label>
        <FileInput
          name="student_card"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Anlage A (PDF, optional)</label>
          <FileInput name="annex_a" accept="application/pdf,.pdf" />
        </div>
        <div>
          <label className="label">Anlage B (PDF, optional)</label>
          <FileInput name="annex_b" accept="application/pdf,.pdf" />
        </div>
      </div>

      {/* Clientseitige „bitte ergänzen"-Meldung — Eingaben bleiben erhalten. */}
      {missing.length > 0 && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          <p className="font-medium">
            Bitte ergänze noch: {missing.join(", ")}.
          </p>
          <p className="mt-1 text-amber-800">
            Deine bereits gemachten Eingaben und ausgewählten Dateien bleiben
            erhalten — du musst nichts erneut eingeben.
          </p>
        </div>
      )}

      {/* Serverseitiger Fehler (z. B. ungültiger Dateityp) — ebenfalls ohne Verlust. */}
      {missing.length === 0 && state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        Antrag einreichen
      </button>
    </form>
  );
}
