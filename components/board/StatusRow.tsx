// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import {
  deleteStatusAction,
  renameStatusAction,
  type State,
} from "@/app/intern/board/[id]/einstellungen/actions";

export function StatusRow({
  boardId,
  status,
}: {
  boardId: number;
  status: { id: number; name: string; isArchiveTrigger: boolean };
}) {
  const [state, action] = useActionState(
    renameStatusAction.bind(null, boardId, status.id),
    {} as State,
  );
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: status.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card flex flex-wrap items-center gap-2 p-3 ${
        isDragging ? "opacity-60 ring-2 ring-brand-400" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none px-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Zum Sortieren ziehen"
        title="Ziehen zum Sortieren"
      >
        ⠿
      </button>

      <form action={action} className="flex flex-1 items-center gap-2">
        <input name="name" defaultValue={status.name} className="input" />
        <SubmitButton className="btn-secondary px-3 py-1.5">
          Umbenennen
        </SubmitButton>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state.success && (
          <span className="text-sm text-green-600">{state.success}</span>
        )}
      </form>

      <DeleteConfirm
        action={deleteStatusAction.bind(null, boardId, status.id)}
        requireWord={false}
        compact
        buttonLabel="Löschen"
        buttonClassName="btn-danger px-3 py-1.5"
        title={`Spalte „${status.name}" löschen`}
        message="Die Spalte wird aus dem Board entfernt. Sie darf keine Karten enthalten und kein Standort-Ziel sein."
      />
    </div>
  );
}
