// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { FileInput } from "@/components/FileInput";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { ProtocolUploadState } from "@/lib/protocol-file-writes";

export function ProtocolFileUpload({ action, extraActions }: { action: (state: ProtocolUploadState, formData: FormData) => Promise<ProtocolUploadState>; extraActions?: ReactNode }) {
  const [state, formAction, pending] = useActionState(async (previous: ProtocolUploadState, data: FormData): Promise<ProtocolUploadState> => {
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Bitte eine nicht leere Datei auswählen." };
    if (file.size > MAX_UPLOAD_BYTES) return { error: "Die Datei darf höchstens 25 MB groß sein." };
    try { return await action(previous, data); }
    catch { return { error: "Upload konnte nicht bestätigt werden. Bitte die Dateiliste prüfen und erneut versuchen." }; }
  }, {});
  const form = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (state.success) { form.current?.reset(); setResetKey(key => key + 1); }
  }, [state]);
  return <div className="border-t border-slate-200 p-4">
    <div className="flex flex-wrap items-center gap-3">
    {extraActions}
    <form ref={form} onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      startTransition(() => formAction(data));
    }} className="flex flex-wrap items-center gap-3">
      <FileInput key={resetKey} name="file" required disabled={pending} label="Datei hinzufügen" onSelect={() => form.current?.requestSubmit()} />
      {pending && <span role="status" className="text-sm text-slate-500">Lädt hoch…</span>}
      {state.error && !pending && <button type="submit" className="btn-secondary btn-sm">Erneut versuchen</button>}
    </form>
    </div>
    <p className="mt-2 text-xs text-slate-500">Die Datei wird direkt nach der Auswahl hochgeladen. Maximal 25 MB pro Datei. Gleichnamige Dateien werden nicht überschrieben.</p>
    {!pending && (state.error || state.success) && <p role={state.error ? "alert" : "status"} className={`mt-2 text-sm ${state.error ? "text-red-700" : "text-green-700"}`}>{state.error ?? state.success}</p>}
  </div>;
}
