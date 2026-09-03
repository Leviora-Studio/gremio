// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import type { ProtocolState } from "@/app/intern/protokolle/actions";

export function SyncProtocolButton({ action }: { action: (state: ProtocolState) => Promise<ProtocolState> }) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className="btn-secondary">{pending ? "Synchronisiert…" : "Jetzt synchronisieren"}</button>
      {(state.error || state.success) && <span className={`text-sm ${state.error ? "text-red-700" : "text-green-700"}`}>{state.error ?? state.success}</span>}
    </form>
  );
}
