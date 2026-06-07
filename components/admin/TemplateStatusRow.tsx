// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import {
  deleteTemplateStatusAction,
  renameTemplateStatusAction,
  type State,
} from "@/app/vorlagen/boards/actions";

export function TemplateStatusRow({
  templateId,
  status,
}: {
  templateId: number;
  status: { id: number; name: string };
}) {
  const [state, action] = useActionState(
    renameTemplateStatusAction.bind(null, templateId, status.id),
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
        <SubmitButton className="btn-secondary btn-sm">Umbenennen</SubmitButton>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </form>

      <DeleteConfirm
        action={deleteTemplateStatusAction.bind(null, templateId, status.id)}
        requireWord={false}
        compact
        buttonLabel="Löschen"
        buttonClassName="btn-danger btn-sm"
        title={`Spalte „${status.name}" löschen`}
        message="Die Spalte wird aus dem Template entfernt."
      />
    </div>
  );
}
