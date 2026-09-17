// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";
import { useActionState } from "react";
import { McpGrantFields } from "@/components/McpGrantFields";
import { saveConnection } from "@/app/intern/konto/verbindungen/actions";
export function McpConnection({
  connection,
  boards,
}: {
  connection: {
    id: string;
    name: string;
    scope: "read" | "write";
    allBoards: boolean;
    boardIds: number[];
    createdAt: string;
    lastUsedAt: string | null;
  };
  boards: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    saveConnection.bind(null, connection.id),
    {},
  );
  return (
    <section className="card p-6">
      <h2 className="break-words text-lg font-semibold">{connection.name}</h2>
      <p className="mb-5 mt-1 text-sm text-slate-500">
        Verbunden am {connection.createdAt}
        {connection.lastUsedAt
          ? ` · Zuletzt verwendet: ${connection.lastUsedAt}`
          : ""}
      </p>
      <form action={action} className="space-y-5">
        <McpGrantFields boards={boards} {...connection} />
        <p className="text-sm text-slate-500">
          Änderungen gelten ab dem nächsten Aufruf. Mit „Freigabe speichern“
          bestätigst du auch neu ausgewählte Boards und zusätzliche
          Schreibrechte. Ohne ausgewählte Boards erhält die Anwendung keinen
          Board-Zugriff.
        </p>
        {state.error && (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="text-sm text-green-700">
            {state.success}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-primary"
            name="decision"
            value="save"
            disabled={pending}
          >
            Freigabe speichern
          </button>
          <button
            className="btn-secondary text-red-700"
            name="decision"
            value="revoke"
            disabled={pending}
          >
            Zugriff widerrufen
          </button>
        </div>
      </form>
    </section>
  );
}
