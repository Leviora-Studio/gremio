"use client";

import { useRef, useState } from "react";
import { FileInput } from "@/components/FileInput";

type Entry = { id: number; file: File; state: "queued" | "uploading" | "success" | "error"; message?: string };

/** Sequential requests preserve per-file limits and avoid burst rate limits.
 * Successful entries are never retried; failed entries keep their original File. */
export function UploadQueue({ upload, label = "Dateien hochladen", onBusy, disabled = false }: {
  upload: (file: File) => Promise<{ error?: string; success?: string }>;
  label?: string;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const list = useRef<Entry[]>([]);
  const running = useRef(false);
  const nextId = useRef(0);
  function publish() { setEntries([...list.current]); }
  async function run() {
    if (running.current) return;
    running.current = true;
    onBusy?.(true);
    try {
      for (;;) {
        const entry = list.current.find((e) => e.state === "queued");
        if (!entry) break;
        entry.state = "uploading"; publish();
        try {
          const result = await upload(entry.file);
          entry.state = result.error ? "error" : "success";
          entry.message = result.error ?? result.success ?? "Hochgeladen";
        } catch {
          entry.state = "error";
          entry.message = "Verbindung unterbrochen. Bitte vor einem erneuten Versuch die Dateiliste prüfen.";
        }
        publish();
      }
    } finally { running.current = false; onBusy?.(false); }
  }
  return <div className="space-y-3">
    <FileInput multiple hideStatus label={label} accept="application/pdf,.pdf" disabled={disabled}
      onFiles={(files) => { list.current.push(...files.map((file): Entry => ({ id: nextId.current++, file, state: "queued" }))); publish(); void run(); }} />
    <ul className="space-y-2 text-sm" aria-live="polite">
      {entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-all font-medium">{entry.file.name}</span>
        <span className={entry.state === "error" ? "text-red-600" : entry.state === "success" ? "text-green-700" : "text-slate-500"}>
          {entry.state === "queued" ? "Wartet …" : entry.state === "uploading" ? "Wird hochgeladen …" : entry.message}
        </span>
        {entry.state === "error" && <button type="button" disabled={disabled} className="text-brand-700 hover:underline" onClick={() => { entry.state = "queued"; publish(); void run(); }}>Erneut versuchen</button>}
      </li>)}
    </ul>
  </div>;
}
