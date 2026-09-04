// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProtocolLogo, ProtocolLogoResult } from "@/lib/protocol-logos";

export function ProtocolLogoSettings({ areaId, initialLogos, action }: { areaId: number; initialLogos: ProtocolLogo[]; action: (form: FormData) => Promise<ProtocolLogoResult> }) {
  const [logos, setLogos] = useState(initialLogos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(type: string, logoId?: number, file?: File) {
    const form = new FormData(); form.set("type", type);
    if (logoId) form.set("logoId", String(logoId));
    if (file) form.set("file", file);
    const result = await action(form);
    if (result.logos) setLogos(result.logos);
    if (result.error) throw new Error(result.error);
  }
  async function change(type: string, logoId: number) {
    if (type === "remove" && !window.confirm("Dieses Logo aus dem Protokollbereich entfernen? Bereits exportierte PDFs bleiben unverändert.")) return;
    setBusy(true); setError("");
    try { await run(type, logoId); } catch (cause) { setError((cause as Error).message || "Logo konnte nicht geändert werden."); } finally { setBusy(false); }
  }
  return <section className="card space-y-4 p-5">
    <h2 className="text-lg font-semibold">Logos für den PDF-Export</h2>
    <p className="text-sm text-slate-500">Diese Logos gelten nur für diesen Protokollbereich. Das Standardlogo wird beim Export vorausgewählt.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {logos.map(logo => <div key={logo.id} className="rounded border border-slate-200 p-3">
        <Image unoptimized src={`/api/protokolle/${areaId}/logos/${logo.id}`} alt={logo.name} width={200} height={80} className="mb-2 h-20 w-full object-contain" />
        <p className="break-words text-sm">{logo.name}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {logo.isDefault ? <span className="text-brand-600">Standardlogo</span> : <button type="button" disabled={busy} className="text-brand-600 hover:underline" onClick={() => change("default", logo.id)}>Als Standard</button>}
          <button type="button" disabled={busy} className="text-red-600 hover:underline" onClick={() => change("remove", logo.id)}>Entfernen</button>
        </div>
      </div>)}
    </div>
    {!logos.length && <p className="text-sm text-slate-500">Noch keine Logos hinterlegt. Ohne Bereichslogo wird das YAML-Logo beziehungsweise logo.png aus dem Sitzungsordner verwendet, falls vorhanden.</p>}
    <label className="block text-sm"><span className="label">Logos hinzufügen (jeweils bis 5 MB)</span><input aria-label="Logos hinzufügen" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={async event => {
      const node = event.currentTarget; const files = [...(node.files ?? [])];
      if (!files.length) return;
      setBusy(true); setError("");
      try { for (const file of files) { if (file.size > 5 * 1024 * 1024) throw new Error(`„${file.name}“ ist größer als 5 MB.`); await run("upload", undefined, file); } node.value = ""; }
      catch (cause) { setError((cause as Error).message || "Upload fehlgeschlagen."); }
      finally { setBusy(false); }
    }} /></label>
    {busy && <p role="status" className="text-sm text-slate-500">Logos werden gespeichert…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
