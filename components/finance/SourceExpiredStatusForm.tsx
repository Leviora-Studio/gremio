// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import { setFinanceSourceExpiredStatusAction, type State } from "@/app/finanzen/actions";
import { Select } from "@/components/Select";

export function SourceExpiredStatusForm({
  financeBoardId,
  boardId,
  expiredStatusId,
  statuses,
}: {
  financeBoardId: number;
  boardId: number;
  expiredStatusId: number | null;
  statuses: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState(
    setFinanceSourceExpiredStatusAction.bind(null, financeBoardId, boardId),
    {} as State,
  );
  const fieldId = `expired-status-${boardId}`;
  return (
    <form action={action} className="space-y-2">
      <label htmlFor={fieldId} className="label">Spalte für Verfallen</label>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          id={fieldId}
          name="expiredStatusId"
          className="w-full sm:w-64"
          defaultValue={expiredStatusId == null ? "" : String(expiredStatusId)}
          options={[
            { value: "", label: "— Keine —" },
            ...statuses.map((status) => ({ value: String(status.id), label: status.name })),
          ]}
        />
        <button type="submit" disabled={pending} className="btn-secondary btn-sm">
          Speichern
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-green-600">{state.success}</p>}
    </form>
  );
}
