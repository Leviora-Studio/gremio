// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState } from "react";
import {
  submitPublicAction,
  type PublicUploadState,
} from "@/app/status/[token]/actions";

export function PublicSubmitForm({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(
    submitPublicAction.bind(null, token),
    {} as PublicUploadState,
  );
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className="btn-success">
        {label}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="mt-2 text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
