// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useMemo, useState } from "react";
import { parseProtocolFrontmatter, protocolMetadataFields, updateProtocolFrontmatter, type ProtocolMetadata } from "@/lib/protocol-frontmatter";

export function ProtocolMetadataPanel({ markdown, disabled, onChange, onDirtyChange }: {
  markdown: string; disabled: boolean; onChange: (markdown: string) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [changes, setChanges] = useState<Partial<ProtocolMetadata>>({});
  const [error, setError] = useState("");
  const parsed = useMemo(() => { try { return { fields: parseProtocolFrontmatter(markdown).fields }; } catch (cause) { return { error: (cause as Error).message }; } }, [markdown]);
  function change(patch: Partial<ProtocolMetadata>) { setChanges(current => ({ ...current, ...patch })); onDirtyChange(true); setError(""); }
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    try { onChange(updateProtocolFrontmatter(markdown, changes)); setChanges({}); onDirtyChange(false); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }}>
    <h2 className="font-semibold">Sitzungsinformationen</h2>
    <p className="text-xs text-slate-500">Wird mit „Übernehmen“ direkt in den YAML-Kopf des Protokolls eingetragen. Anschließend das Protokoll in Nextcloud speichern.</p>
    {protocolMetadataFields.map(([key, label]) => <label key={key} className="block text-sm">
      <span className="label">{label}</span>
      <input aria-label={label} className="input" maxLength={2000} disabled={disabled || !!parsed.error} value={changes[key] ?? parsed.fields?.[key] ?? ""} onChange={event => change({ [key]: event.target.value })} />
    </label>)}
    <p className="text-xs text-slate-500">Ein beim Export gewähltes Bereichslogo hat Vorrang vor „Logo-Dateiname“. Ohne Bereichslogo kann eine Bilddatei direkt aus diesem Sitzungsordner verwendet werden.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled || !!parsed.error} checked={changes.unterschriften ?? parsed.fields?.unterschriften ?? true} onChange={event => change({ unterschriften: event.target.checked })} />Unterschriftenfelder anzeigen</label>
    {(error || parsed.error) && <p role="alert" className="text-sm text-red-700">{error || parsed.error}</p>}
    <div className="flex gap-2">
      <button type="submit" className="btn-primary btn-sm" disabled={disabled || !!parsed.error || !Object.keys(changes).length}>Übernehmen</button>
      {!!Object.keys(changes).length && <button type="button" className="btn-secondary btn-sm" onClick={() => { setChanges({}); onDirtyChange(false); setError(""); }}>Abbrechen</button>}
    </div>
  </form>;
}
