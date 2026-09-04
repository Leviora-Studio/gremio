// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import type { ProtocolState } from "@/app/intern/protokolle/actions";

export function CreateSessionForm({ action, today }: { action: (state: ProtocolState, formData: FormData) => Promise<ProtocolState>; today: string }) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  const [date, setDate] = useState(today);
  return (
    <form action={formAction} className="card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label className="label">Sitzungsdatum</label>
        <DatePicker portal name="date" ariaLabel="Sitzungsdatum" value={date} onChange={setDate} />
      </div>
      <button type="submit" disabled={pending || !date} className="btn-primary">{pending ? "Wird angelegt…" : "Neue Sitzung"}</button>
      {state.error && <p className="basis-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
