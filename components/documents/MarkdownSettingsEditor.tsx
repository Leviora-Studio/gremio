// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { MarkdownLiveEditor, type MarkdownLiveEditorHandle } from "./MarkdownLiveEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { Select } from "@/components/Select";
import { formatMarkdown, indentMarkdown, type MarkdownSelection } from "@/lib/markdown-formatting";

/** Embedded editor: same renderer and formatting tools, no document/sidebar or server save. */
export function MarkdownSettingsEditor({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<"live" | "edit" | "preview">("live");
  const live = useRef<MarkdownLiveEditorHandle>(null);
  const raw = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<MarkdownSelection>({ start: 0, end: 0 });
  const pending = useRef<MarkdownSelection | null>(null);
  const history = useRef<{ value: string; selection: MarkdownSelection }[]>([]);
  const future = useRef<{ value: string; selection: MarkdownSelection }[]>([]);
  const [revision, setRevision] = useState(0);
  function capture() {
    selection.current = mode === "edit" && raw.current ? { start: raw.current.selectionStart, end: raw.current.selectionEnd } : live.current?.selection() ?? selection.current;
    return selection.current;
  }
  function change(next: string, range?: MarkdownSelection) {
    if (next !== value) { history.current.push({ value, selection: { ...capture() } }); if (history.current.length > 100) history.current.shift(); future.current = []; }
    if (range) { pending.current = range; setRevision(count => count + 1); }
    onChange(next);
  }
  useLayoutEffect(() => {
    const range = pending.current;
    if (!range) return;
    pending.current = null; selection.current = range;
    if (mode === "edit") { raw.current?.focus(); raw.current?.setSelectionRange(range.start, range.end); }
    else if (mode === "live") live.current?.focusRange(range.start, range.end);
  }, [value, revision, mode]);
  return <div role="group" aria-label={label} className="min-w-0 rounded-lg border border-slate-200 bg-white" onKeyDownCapture={event => {
    if (disabled || mode === "preview" || event.nativeEvent.isComposing) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
      event.preventDefault(); event.stopPropagation();
      const redo = key === "y" || event.shiftKey;
      const source = redo ? future.current : history.current; const target = redo ? history.current : future.current;
      const snapshot = source.pop(); if (!snapshot) return;
      target.push({ value, selection: { ...capture() } }); pending.current = snapshot.selection; onChange(snapshot.value); setRevision(count => count + 1);
    }
  }}>
    <MarkdownToolbar disabled={disabled || mode === "preview"} onCapture={capture} onCommand={command => { const result = formatMarkdown(value, capture(), command); change(result.markdown, result.selection); }} leading={<Select portal ariaLabel={`${label}: Ansicht`} className="w-36" value={mode} onChange={value => setMode(value as typeof mode)} options={[{ value: "live", label: "Live Vorschau" }, { value: "edit", label: "Bearbeiten" }, { value: "preview", label: "Vorschau" }]} />} />
    <div className="max-h-[32rem] min-h-48 overflow-auto p-4 sm:p-5 [&>[data-markdown-renderer]]:!min-h-40 [&>[data-markdown-renderer]]:!border-0 [&>[data-markdown-renderer]]:!p-0">
      {mode === "edit" ? <textarea ref={raw} aria-label={`${label}: Markdown`} disabled={disabled} className="min-h-64 w-full resize-y border-0 bg-transparent font-mono text-sm outline-none" value={value} onChange={event => change(event.target.value)} onSelect={capture} onKeyDown={event => {
        if (event.key === "Tab") { event.preventDefault(); const edit = indentMarkdown(value, capture(), event.shiftKey); change(edit.markdown, edit.selection); }
      }} /> : <MarkdownLiveEditor ref={live} markdown={value} readOnly={disabled || mode === "preview"} onChange={change} onCommit={() => {}} />}
    </div>
  </div>;
}
