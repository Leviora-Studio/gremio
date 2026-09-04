// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import type { ProtocolMarkdownCreateState } from "@/lib/protocol-file-writes";

export function CreateMarkdownFileButton({ action }: { action: (data: FormData) => Promise<ProtocolMarkdownCreateState> }) {
  const router = useRouter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  return <>
    <button type="button" className="btn-secondary btn-sm" onClick={() => { setError(undefined); setOpen(true); }}>Markdown-Datei erstellen</button>
    <Modal open={open} title="Markdown-Datei erstellen" onClose={() => { if (!busy.current) setOpen(false); }}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault();
        if (busy.current) return;
        const data = new FormData(event.currentTarget);
        busy.current = true; setPending(true); setError(undefined);
        try {
          const result = await action(data);
          if (result.href) { setOpen(false); router.push(result.href); }
          else setError(result.error ?? "Die Datei konnte nicht erstellt werden.");
        } catch { setError("Erstellen konnte nicht bestätigt werden. Bitte die Dateiliste prüfen, bevor du es erneut versuchst."); }
        finally { busy.current = false; setPending(false); }
      }}>
        <div><label htmlFor={inputId} className="label">Dateiname</label><input id={inputId} name="filename" className="input" defaultValue="Neue Datei.md" required maxLength={255} disabled={pending} autoFocus onFocus={event => event.currentTarget.setSelectionRange(0, event.currentTarget.value.replace(/\.md$/i, "").length)} /></div>
        <p className="text-sm text-slate-500">Die leere Datei wird im geöffneten Ordner erstellt und anschließend im Editor geöffnet. Die Endung .md wird bei Bedarf ergänzt.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={pending} onClick={() => setOpen(false)}>Abbrechen</button><button type="submit" className="btn-primary" disabled={pending}>{pending ? "Erstellt …" : "Erstellen und öffnen"}</button></div>
      </form>
    </Modal>
  </>;
}
