// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { FileInput } from "@/components/FileInput";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addPublicFileAction,
  type PublicUploadState,
} from "@/app/status/[token]/actions";

export function PublicUploadForm({ token }: { token: string }) {
  const [state, action] = useActionState(
    addPublicFileAction.bind(null, token),
    {} as PublicUploadState,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form ref={ref} action={action} className="space-y-3" noValidate>
      <FileInput name="file" accept="application/pdf,.pdf" label="PDF auswählen" />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Datei hochladen</SubmitButton>
        {(state.error || state.success) && (
          <span
            className={`text-sm ${
              state.error ? "text-red-600" : "text-green-600"
            }`}
          >
            {state.error ?? state.success}
          </span>
        )}
      </div>
    </form>
  );
}
