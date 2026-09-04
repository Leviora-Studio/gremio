// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState } from "react";
import { usePublicUploads } from "@/components/PublicUploadScope";
import {
  submitPublicAction,
  type PublicUploadState,
} from "@/app/status/[token]/actions";

export function PublicSubmitForm({
  token,
  label,
  purpose,
}: {
  token: string;
  label: string;
  purpose: "receipt" | "resubmission";
}) {
  const { busy } = usePublicUploads();
  const [state, action, pending] = useActionState(
    submitPublicAction.bind(null, token),
    {} as PublicUploadState,
  );
  return (
    <form action={action}>
      <input type="hidden" name="purpose" value={purpose} />
      <button type="submit" disabled={pending || busy} className="btn-success">
        {label}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="mt-2 text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
