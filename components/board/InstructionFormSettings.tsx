// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { FileInput } from "@/components/FileInput";
import { SubmitButton } from "@/components/SubmitButton";
import {
  deleteInstructionFormAction,
  setInstructionFormAction,
  type State,
} from "@/app/intern/board/[id]/einstellungen/actions";

export function InstructionFormSettings({
  boardId,
  config,
}: {
  boardId: number;
  config: {
    enabled: boolean;
    filename: string | null;
    size: number | null;
  };
}) {
  const [selected, setSelected] = useState(false);
  const [state, action, pending] = useActionState(
    setInstructionFormAction.bind(null, boardId),
    {} as State,
  );
  const hasTemplate = !!config.filename;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Hinterlege eine PDF-Vorlage. Ist die Funktion aktiv, können
        Board-Mitglieder auf jeder Karte daraus eine neue Anweisung im
        integrierten PDF-Editor erstellen.
      </p>

      {hasTemplate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2">
          <div className="min-w-0 text-sm">
            <a
              href={`/api/board/${boardId}/instruction-template`}
              target="_blank"
              rel="noopener"
              className="block truncate text-brand-600 hover:underline"
            >
              {config.filename}
            </a>
            {config.size != null && (
              <span className="text-xs text-slate-400">
                {Math.max(1, Math.round(config.size / 1024))} KB
              </span>
            )}
          </div>
          <DeleteConfirm
            action={deleteInstructionFormAction.bind(null, boardId)}
            requireWord={false}
            compact
            buttonLabel="Vorlage entfernen"
            buttonClassName="text-xs text-red-600 hover:underline"
            title="Anweisungsformular-Vorlage entfernen"
            message="Die PDF-Vorlage wird entfernt und die Funktion deaktiviert. Bereits erstellte Anweisungen auf Karten bleiben erhalten."
          />
        </div>
      )}

      <form action={action} className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={config.enabled}
            disabled={pending || (!hasTemplate && !selected)}
            className="h-4 w-4"
          />
          Anweisungsformular für dieses Board aktiv
        </label>
        {!hasTemplate && !selected && (
          <p className="text-xs text-slate-500">
            Die Funktion kann aktiviert werden, sobald eine PDF-Vorlage
            ausgewählt wurde.
          </p>
        )}

        <div>
          <label className="label">
            {hasTemplate ? "PDF-Vorlage ersetzen" : "PDF-Vorlage"}
          </label>
          <FileInput
            name="template"
            accept="application/pdf,.pdf"
            label={hasTemplate ? "Neue PDF auswählen" : "PDF auswählen"}
            disabled={pending}
            onSelect={() => setSelected(true)}
          />
          <p className="mt-1 text-xs text-slate-400">PDF, maximal 25 MB</p>
        </div>

        <SubmitButton className="btn-primary">
          Einstellungen speichern
        </SubmitButton>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-green-700">{state.success}</p>
        )}
      </form>
    </div>
  );
}
