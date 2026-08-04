// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/feedback/actions";
import {
  ANONYMOUS_SUBMITTER,
  FEEDBACK_MAX_LENGTH,
  SUBMITTER_NAME_MAX_LENGTH,
} from "@/lib/feedback-constants";

/**
 * Öffentliches Feedback-Formular — im Aufbau identisch zum Antragsformular
 * (`PublicAntragForm`): gleiche Label-/Input-Klassen, gleiche „bitte
 * ergänze"-Meldung, gleicher Submit-Button.
 */
export function PublicFeedbackForm({
  areas,
  guard,
}: {
  areas: { id: number; name: string }[];
  guard: { ts: string; sig: string };
}) {
  const [state, action, pending] = useActionState(
    submitFeedbackAction,
    {} as FeedbackState,
  );
  const [missing, setMissing] = useState<string[]>([]);

  // Wie im Antragsformular bewusst KEIN <form action={action}>: React 19 setzt
  // das Formular nach einer Action zurück und würde dabei den (womöglich langen)
  // Freitext verwerfen. Über onSubmit + manuellen Dispatch bleibt alles erhalten.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const hasText = (key: string) => String(fd.get(key) ?? "").trim() !== "";

    const need: string[] = [];
    if (!hasText("areaId")) need.push("Bereich");
    // Der Name ist bewusst NICHT dabei — leer lassen ist erlaubt und wird
    // serverseitig zu „Anonym".
    if (!hasText("feedback")) need.push("Feedback");

    setMissing(need);
    if (need.length > 0) return;

    startTransition(() => action(fd));
  }

  // „Danke"-Bestätigung (auch für still verworfene Bot-Einsendungen).
  if (state.ok) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold text-green-700">
          Vielen Dank — dein Feedback wurde übermittelt.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Zeitfalle (signiert) */}
      <input type="hidden" name="ts" value={guard.ts} />
      <input type="hidden" name="sig" value={guard.sig} />
      {/* Honeypot: für Menschen unsichtbar, Bots füllen es aus → still verworfen */}
      <div className="absolute left-[-9999px] top-[-9999px]" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div>
        <label className="label">Bereich *</label>
        <Select
          name="areaId"
          placeholder="Bitte wählen…"
          defaultValue={state.values?.areaId ?? ""}
          options={areas.map((a) => ({ value: String(a.id), label: a.name }))}
        />
      </div>

      <div>
        <label htmlFor="fb-name" className="label">
          Dein Name (optional)
        </label>
        <input
          id="fb-name"
          name="submitterName"
          maxLength={SUBMITTER_NAME_MAX_LENGTH}
          className="input"
          placeholder={`Leer lassen für „${ANONYMOUS_SUBMITTER}"`}
          defaultValue={state.values?.submitterName ?? ""}
        />
        <p className="mt-1 text-sm text-slate-500">
          Lässt du das Feld leer, erscheint dein Feedback als „
          {ANONYMOUS_SUBMITTER}".
        </p>
      </div>

      <div>
        <label htmlFor="fb-text" className="label">
          Dein Feedback *
        </label>
        <textarea
          id="fb-text"
          name="feedback"
          required
          rows={7}
          maxLength={FEEDBACK_MAX_LENGTH}
          className="input resize-y"
          placeholder="Was möchtest du dem Gremium mitteilen?"
          defaultValue={state.values?.feedback ?? ""}
        />
        <p className="mt-1 text-sm text-slate-500">
          Bis zu {FEEDBACK_MAX_LENGTH.toLocaleString("de-DE")} Zeichen.
        </p>
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
            Deine bereits gemachten Eingaben bleiben erhalten — du musst nichts
            erneut eingeben.
          </p>
        </div>
      )}

      {/* Serverseitiger Fehler — ebenfalls ohne Verlust des Freitexts. */}
      {missing.length === 0 && state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        Feedback absenden
      </button>
    </form>
  );
}
