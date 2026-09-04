// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import Image from "next/image";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { ProtocolLogo } from "@/lib/protocol-logos";
import type { ProtocolExportInput, ProtocolExportResult } from "@/lib/protocol-export";

export function ProtocolExportButton({ areaId, sourceName, logos, disabled, action, compact = false }: {
  areaId: number; sourceName: string; logos: ProtocolLogo[]; disabled: boolean; action: (input: ProtocolExportInput) => Promise<ProtocolExportResult>; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [logoId, setLogoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProtocolExportResult>({});
  return <>
    <button type="button" aria-label="Protokoll exportieren" className={`btn-secondary ${compact ? "btn-sm !h-8 !px-3 !text-[13px]" : ""}`} disabled={disabled || busy} title={disabled ? "Bitte zuerst alle Änderungen übernehmen und das Protokoll in Nextcloud speichern." : undefined} onClick={() => {
      setFilename(sourceName.replace(/\.(md|markdown)$/i, "") + ".pdf");
      setLogoId(logos.find(logo => logo.isDefault)?.id ?? logos[0]?.id ?? null); setResult({}); setOpen(true);
    }}>{compact ? "Exportieren" : "Protokoll exportieren"}</button>
    <Modal open={open} title="Protokoll exportieren" onClose={() => { if (!busy) setOpen(false); }}>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (busy || disabled) return;
        setBusy(true); setResult({});
        try { const response = await action({ filename: filename.trim(), logoId }); setResult(response); if (response.success) setOpen(false); }
        catch { setResult({ error: "Der Export konnte nicht bestätigt werden. Bitte die Dateiliste prüfen, bevor du es erneut versuchst." }); }
        finally { setBusy(false); }
      }}>
        <p className="text-sm text-slate-600">Exportiert wird die gespeicherte Markdown-Datei aus Nextcloud einschließlich ihrer YAML-Sitzungsinformationen.</p>
        <label className="block"><span className="label">PDF-Dateiname</span><input autoFocus aria-label="PDF-Dateiname" required maxLength={200} value={filename} disabled={busy} className="input" onChange={event => setFilename(event.target.value)} /></label>
        {!!logos.length && <fieldset disabled={busy}><legend className="label">Logo</legend><div className="grid gap-3 sm:grid-cols-3">
          {logos.map(logo => <label key={logo.id} className={`cursor-pointer rounded-md p-3 ${logoId === logo.id ? "bg-brand-50 text-brand-700" : "bg-slate-50"}`}>
            <input type="radio" name="export-logo" value={logo.id} checked={logoId === logo.id} onChange={() => setLogoId(logo.id)} />
            <Image unoptimized src={`/api/protokolle/${areaId}/logos/${logo.id}`} alt={logo.name} width={200} height={80} className="my-2 h-20 w-full object-contain" />
            <span className="break-words text-sm">{logo.name}{logo.isDefault ? " (Standard)" : ""}</span>
          </label>)}
        </div></fieldset>}
        {result.error && <p role="alert" className="text-sm text-red-700">{result.error}</p>}
        <div className="flex gap-2"><button type="submit" disabled={busy || disabled} className="btn-primary">{busy ? "PDF wird erstellt…" : "Exportieren"}</button><button type="button" disabled={busy} className="btn-secondary" onClick={() => setOpen(false)}>Abbrechen</button></div>
      </form>
    </Modal>
    {!open && result.success && <p role="status" className="text-sm text-green-700">{result.success}</p>}
  </>;
}
