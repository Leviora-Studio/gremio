// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { FileInput } from "@/components/FileInput";
import { STUDENT_CARD_ACCEPT } from "@/lib/inventory-attachment-kinds";
import {
  createInventoryLoanRequestAction,
  type RequestState,
} from "@/app/inventar/request-actions";

export type LoanRequestTarget = {
  /** single = Einzelstück, bulk = Mengen-Gegenstand, group = Obergruppe */
  kind: "single" | "bulk" | "group";
  name: string;
  /** Bei kind='group' gesetzt, sonst null. */
  groupName: string | null;
  /** Bei kind='single'|'bulk' gesetzt, sonst null. */
  itemId: number | null;
  available: number;
};

/**
 * Öffentliches Ausleih-Anfrageformular — bewusst als eigene Seite und im selben
 * Aufbau wie das Antragsformular (`PublicAntragForm`): gleiche Label-/Input-
 * Klassen, gleicher FileInput, gleiche „bitte ergänze"-Meldung, gleicher
 * Submit-Button.
 */
export function PublicLoanRequestForm({
  boardId,
  target,
  guard,
}: {
  boardId: number;
  target: LoanRequestTarget;
  guard: { ts: string; sig: string };
}) {
  const [state, action, pending] = useActionState(
    createInventoryLoanRequestAction,
    {} as RequestState,
  );
  const [missing, setMissing] = useState<string[]>([]);
  const showQuantity = target.kind !== "single";
  const aktuellerGuard = state.guard ?? guard;

  // Wie im Antragsformular bewusst KEIN <form action={action}>: React 19 setzt
  // das Formular nach einer Action zurück und würde dabei die ausgewählte
  // Ausweis-Datei verwerfen. Über onSubmit + manuellen Dispatch bleiben alle
  // Eingaben erhalten und können nach einer Fehlermeldung ergänzt werden.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const hasText = (key: string) => String(fd.get(key) ?? "").trim() !== "";
    const hasFile = (key: string) => {
      const v = fd.get(key);
      return v instanceof File && v.size > 0;
    };

    const need: string[] = [];
    if (!hasText("borrower")) need.push("Name");
    if (!hasText("email")) need.push("E-Mail");
    if (!hasText("startDate")) need.push("Von (Datum + Uhrzeit)");
    if (!hasText("endDate")) need.push("Bis (Datum + Uhrzeit)");
    if (!hasText("purpose")) need.push("Verwendungsort / Zweck");
    if (!hasFile("studentCard")) need.push("Studierendenausweis");

    setMissing(need);
    if (need.length > 0) return; // nichts absenden, nichts verwerfen

    startTransition(() => action(fd));
  }

  // „Danke"-Bestätigung — auch für still verworfene Bot-Einsendungen. Bewusst
  // ohne Status-Link: den gibt es nur bei einer echten Anfrage (dort leitet die
  // Action direkt auf die Statusseite weiter).
  if (state.ok) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold text-green-700">
          Vielen Dank — deine Anfrage wurde übermittelt.
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

      {target.kind === "group" ? (
        <>
          <input type="hidden" name="boardId" value={boardId} />
          <input type="hidden" name="groupName" value={target.groupName ?? ""} />
        </>
      ) : (
        <input type="hidden" name="itemId" value={target.itemId ?? ""} />
      )}

      {showQuantity && (
        <div>
          <label htmlFor="rq-qty" className="label">
            Stückzahl *
          </label>
          <input
            id="rq-qty"
            name="quantity"
            type="number"
            min={1}
            max={target.available}
            className="input w-32"
            defaultValue={state.values?.quantity ?? "1"}
          />
          <p className="mt-1 text-sm text-slate-500">
            {target.kind === "group"
              ? `Bis zu ${target.available} Stück — die konkreten Stücke werden automatisch reserviert.`
              : `Beliebige Menge bis ${target.available} Stück.`}
          </p>
        </div>
      )}

      <div>
        <label htmlFor="rq-borrower" className="label">
          Dein Name *
        </label>
        <input
          id="rq-borrower"
          name="borrower"
          className="input"
          placeholder="z. B. Max Mustermann"
          defaultValue={state.values?.borrower ?? ""}
        />
      </div>

      <div>
        <label htmlFor="rq-email" className="label">
          E-Mail *
        </label>
        <input
          id="rq-email"
          name="email"
          type="email"
          className="input"
          placeholder="z. B. max@example.org"
          defaultValue={state.values?.email ?? ""}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rq-start" className="label">
            Von (Datum + Uhrzeit) *
          </label>
          <input
            id="rq-start"
            name="startDate"
            type="datetime-local"
            className="input"
            defaultValue={state.values?.startDate ?? ""}
          />
        </div>
        <div>
          <label htmlFor="rq-end" className="label">
            Bis (Datum + Uhrzeit) *
          </label>
          <input
            id="rq-end"
            name="endDate"
            type="datetime-local"
            className="input"
            defaultValue={state.values?.endDate ?? ""}
          />
        </div>
      </div>

      <div>
        <label htmlFor="rq-purpose" className="label">
          Verwendungsort / Zweck *
        </label>
        <input
          id="rq-purpose"
          name="purpose"
          className="input"
          placeholder="z. B. Grillabend am FB5"
          defaultValue={state.values?.purpose ?? ""}
        />
      </div>

      <div>
        <label className="label">Studierendenausweis (PDF, PNG, JPG) *</label>
        <FileInput name="studentCard" accept={STUDENT_CARD_ACCEPT} />
        <p className="mt-1 text-sm text-slate-500">
          Wird nur intern zur Prüfung verwendet und ist über den Status-Link
          nicht abrufbar.
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
            Deine bereits gemachten Eingaben und die ausgewählte Datei bleiben
            erhalten — du musst nichts erneut eingeben.
          </p>
        </div>
      )}

      {/* Serverseitiger Fehler (z. B. Menge weg) — ebenfalls ohne Verlust. */}
      {missing.length === 0 && state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        Anfrage absenden
      </button>
    </form>
  );
}
