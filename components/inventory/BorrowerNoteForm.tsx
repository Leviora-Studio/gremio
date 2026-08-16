// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  setLoanBorrowerNoteAction,
  type BorrowerNoteState,
} from "@/app/intern/inventar/item/[itemId]/actions";

/** „Hinweise für den Entleiher" mit Erfolgs-/Fehlermeldung nach dem Speichern. */
export function BorrowerNoteForm({
  loanId,
  initial,
}: {
  loanId: number;
  initial: string;
}) {
  const [state, action] = useActionState(
    setLoanBorrowerNoteAction,
    {} as BorrowerNoteState,
  );
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    if (!state.ok) return;
    setSavedAt(true);
    const t = setTimeout(() => setSavedAt(false), 3000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <form action={action} className="card space-y-2 p-5">
      <input type="hidden" name="loanId" value={loanId} />
      <div>
        <h2 className="font-semibold">Hinweise für den Entleiher</h2>
        <p className="text-sm text-slate-500">
          Diese Hinweise sieht der Entleiher über seinen Status-Link.
        </p>
      </div>
      <textarea
        name="borrowerNote"
        rows={3}
        className="input"
        defaultValue={initial}
        placeholder="z. B. Abholung Mo–Fr 10–14 Uhr im Stura-Büro, Pfand 20 €."
      />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Speichern</SubmitButton>
        {savedAt && (
          <span className="text-sm font-medium text-green-600">
            ✓ Gespeichert
          </span>
        )}
        {state.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}
