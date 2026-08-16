// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FileInput } from "@/components/FileInput";
import {
  uploadFormDocumentAction,
  type State,
} from "@/app/admin/formular/actions";

export function FormDocUpload() {
  const [state, action, pending] = useActionState(
    uploadFormDocumentAction,
    {} as State,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state.success) setResetKey((k) => k + 1);
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      className="flex flex-wrap items-center gap-3"
    >
      <FileInput
        key={resetKey}
        name="file"
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv"
        label="Datei hinzufügen"
        disabled={pending}
        onSelect={() => formRef.current?.requestSubmit()}
      />
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      {state.success && (
        <span className="text-sm text-green-600">{state.success}</span>
      )}
    </form>
  );
}
