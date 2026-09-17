// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";
import { useActionState } from "react";
import { McpGrantFields } from "@/components/McpGrantFields";
export function McpConsent({
  action,
  boards,
}: {
  action: (
    state: { error?: string },
    form: FormData,
  ) => Promise<{ error?: string }>;
  boards: { id: number; name: string }[];
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="space-y-6">
      <McpGrantFields boards={boards} />
      <p className="text-sm text-slate-600">
        Die Anwendung erhält Zugriff auf die ausgewählten Inhalte,
        einschließlich sichtbarer Notizen, Kommentare und Anhänge. Du kannst die
        Freigabe jederzeit in deinem Konto ändern oder widerrufen.
      </p>
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-primary"
          name="decision"
          value="allow"
          disabled={pending}
        >
          Zugriff erlauben
        </button>
        <button
          className="btn-secondary"
          name="decision"
          value="deny"
          disabled={pending}
        >
          Ablehnen
        </button>
      </div>
    </form>
  );
}
