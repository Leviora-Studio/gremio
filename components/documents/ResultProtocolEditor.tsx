// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MarkdownLiveEditor, type MarkdownLiveEditorHandle } from "./MarkdownLiveEditor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { ProtocolExportButton } from "@/components/protocols/ProtocolExportButton";
import type { ProtocolLogo } from "@/lib/protocol-logos";
import type { ProtocolExportInput, ProtocolExportResult } from "@/lib/protocol-export";
import { formatMarkdown, indentMarkdown, type MarkdownCommand, type MarkdownSelection } from "@/lib/markdown-formatting";
import {
  addResultSource,
  analyzeResultProtocol,
  removeResultSource,
  selectedResultSourceIds,
  structuralResultSourceIds,
  type ResultProtocolAnalysis,
  type ResultSourceBlock,
} from "@/lib/result-protocol";

type SaveResponse = { content?: string; fileId?: string | null; savedToNextcloud?: boolean; openedExisting?: boolean; success?: string; error?: string };
type ReloadResponse = { content?: string; fileId?: string | null; error?: string };

function SourceBlock({ block, selected, onToggle }: { block: ResultSourceBlock; selected: boolean; onToggle: () => void }) {
  return <div className={`grid grid-cols-[minmax(0,1fr)_5.75rem] overflow-hidden rounded-lg border-2 transition-colors ${selected ? "border-brand-500 bg-brand-50 shadow-sm ring-1 ring-brand-200" : "border-slate-300 bg-white"}`} data-result-source-block={block.id} data-selected={selected ? "true" : "false"}>
    <div className="min-w-0 p-3">
      <p className={`mb-2 text-xs font-semibold ${selected ? "text-brand-800" : block.detectedAs ? "text-amber-800" : "text-slate-500"}`}>{block.detectedAs ? `Als ${block.detectedAs} erkannt` : block.selectable ? selected ? "Im Ergebnis enthalten" : "Nicht im Ergebnis" : "Strukturelement"}</p>
      <div className="overflow-hidden rounded border border-slate-200 bg-white p-3 text-sm">
        {block.selectable
          ? <MarkdownLiveEditor markdown={block.markdown} readOnly compact onChange={() => {}} />
          : <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-600">{block.markdown}</pre>}
      </div>
    </div>
    <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 border-l-2 px-2 text-center text-xs font-semibold transition-colors ${selected ? "border-brand-500 bg-brand-600 text-white" : block.selectable ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-brand-50 hover:text-brand-800" : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"}`}>
      <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={selected} disabled={!block.selectable} onChange={onToggle} />
      <span>{block.selectable ? selected ? "Enthalten" : "Übernehmen" : "Fix"}</span>
    </label>
  </div>;
}

export function ResultProtocolEditor({
  sourceContent,
  initialResult,
  initialFileId,
  initiallyPersisted,
  filename,
  folderName,
  backHref,
  saveAction,
  reloadAction,
  areaId,
  logos,
  exportAction,
}: {
  sourceContent: string;
  initialResult: string;
  initialFileId: string | null;
  initiallyPersisted: boolean;
  filename: string;
  folderName: string;
  backHref: string;
  saveAction: (expectedFileId: string | null | undefined, content: string) => Promise<SaveResponse>;
  reloadAction: (expectedFileId: string | null) => Promise<ReloadResponse>;
  areaId: number;
  logos: ProtocolLogo[];
  exportAction: (input: ProtocolExportInput) => Promise<ProtocolExportResult>;
}) {
  const analysis = useMemo<ResultProtocolAnalysis>(() => analyzeResultProtocol(sourceContent), [sourceContent]);
  const [content, setContent] = useState(initialResult);
  const [savedContent, setSavedContent] = useState(initiallyPersisted ? initialResult : "");
  const [persisted, setPersisted] = useState(initiallyPersisted);
  const [fileId, setFileId] = useState<string | null>(initialFileId);
  const [selected, setSelected] = useState(() => initiallyPersisted
    ? selectedResultSourceIds(initialResult)
    : new Set([...analysis.prelude, ...analysis.tops.flatMap(top => top.blocks)].filter(block => block.automatic).map(block => block.id)));
  const [mode, setMode] = useState<"live" | "edit" | "preview">("live");
  const [mobilePane, setMobilePane] = useState<"source" | "result">("source");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [confirmation, setConfirmation] = useState<{ type: "block"; id: string } | { type: "reload" } | { type: "leave"; href: string } | null>(null);
  const live = useRef<MarkdownLiveEditorHandle>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<MarkdownSelection>({ start: 0, end: 0 });
  const allowUnload = useRef(false);
  const sourcePane = useRef<HTMLElement>(null);
  const resultPane = useRef<HTMLElement>(null);
  const scrollLock = useRef<HTMLElement | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const dirty = !persisted || content !== savedContent;
  const busy = saving || loading;
  const selectedBlocks = [...selected].length;
  const selectedTops = analysis.tops.filter(top => top.blocks.some(block => selected.has(block.id))).length;
  const topsWithoutAutomatic = analysis.tops.filter(top => !top.blocks.some(block => block.automatic)).length;

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty && !allowUnload.current) event.preventDefault(); };
    window.addEventListener("beforeunload", unload); return () => { window.removeEventListener("beforeunload", unload); if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current); };
  }, [dirty]);
  useLayoutEffect(() => {
    const node = textarea.current;
    if (mode !== "edit" || !node) return;
    const fit = () => { node.style.height = "0px"; node.style.height = `${node.scrollHeight + 2}px`; };
    fit(); let width = node.clientWidth;
    const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; fit(); } });
    observer.observe(node); return () => observer.disconnect();
  }, [content, mode]);

  function syncScroll(from: HTMLElement, to: HTMLElement) {
    if (scrollLock.current === from || from.clientHeight === 0 || to.clientHeight === 0) return;
    const fromRange = from.scrollHeight - from.clientHeight;
    const toRange = to.scrollHeight - to.clientHeight;
    if (fromRange <= 0 || toRange <= 0) return;
    scrollLock.current = to;
    to.scrollTop = (from.scrollTop / fromRange) * toRange;
    if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => { scrollLock.current = null; });
  }

  function capture() {
    if (mode === "edit" && textarea.current) selection.current = { start: textarea.current.selectionStart, end: textarea.current.selectionEnd };
    else if (mode === "live") selection.current = live.current?.selection() ?? selection.current;
    return selection.current;
  }
  function change(next: string, range?: MarkdownSelection) {
    setContent(next); setMessage({});
    if (range) { selection.current = range; requestAnimationFrame(() => mode === "live" ? live.current?.focusRange(range.start, range.end) : textarea.current?.setSelectionRange(range.start, range.end)); }
  }
  function command(value: MarkdownCommand) {
    if (mode === "preview" || busy) return;
    const result = formatMarkdown(content, capture(), value); change(result.markdown, result.selection);
  }
  function toggle(block: ResultSourceBlock) {
    if (busy || !block.selectable) return;
    if (!selected.has(block.id)) {
      let next = content;
      for (const id of structuralResultSourceIds(analysis, block.id)) next = addResultSource(next, analysis, id);
      change(next);
      setSelected(selectedResultSourceIds(next)); setMobilePane("result"); return;
    }
    const removal = removeResultSource(content, analysis, block.id);
    if (removal.status === "modified") { setConfirmation({ type: "block", id: block.id }); return; }
    setSelected(current => { const next = new Set(current); next.delete(block.id); return next; });
    if (removal.status === "removed") change(removal.markdown);
    else setMessage({ error: "Die Zuordnungsmarker dieses Blocks fehlen. Der Inhalt bleibt vorsichtshalber als manueller Text erhalten." });
  }
  function confirmRemoval() {
    if (confirmation?.type !== "block") return;
    const id = confirmation.id;
    const removal = removeResultSource(content, analysis, id, true);
    setSelected(current => { const next = new Set(current); next.delete(id); return next; });
    change(removal.markdown); setConfirmation(null);
  }
  async function save() {
    if (busy) return; setSaving(true); const submitted = content;
    try {
      const result = await saveAction(persisted ? fileId : undefined, submitted);
      if (result.error || result.content === undefined || !result.savedToNextcloud) { setMessage({ error: result.error ?? "Speichern konnte nicht bestätigt werden." }); return; }
      setPersisted(true); setFileId(result.fileId ?? null); setContent(result.content); setSavedContent(result.content);
      setSelected(selectedResultSourceIds(result.content));
      setMessage({ success: result.success ?? "In Nextcloud gespeichert." });
    } catch { setMessage({ error: "Speichern konnte nicht bestätigt werden. Bitte erneut versuchen." }); }
    finally { setSaving(false); }
  }
  async function reload(confirmed = false) {
    if (!persisted || busy) return;
    if (dirty && !confirmed) { setConfirmation({ type: "reload" }); return; }
    setLoading(true);
    try {
      const result = await reloadAction(fileId);
      if (result.error || result.content === undefined) { setMessage({ error: result.error ?? "Laden fehlgeschlagen." }); return; }
      setContent(result.content); setSavedContent(result.content); setFileId(result.fileId ?? null); setSelected(selectedResultSourceIds(result.content));
      setMessage({ success: "Aktueller Nextcloud-Stand geladen." });
    } catch { setMessage({ error: "Die Ergebnisdatei konnte nicht neu geladen werden." }); }
    finally { setLoading(false); }
  }
  function jumpToTop(topId: string) {
    setMobilePane("result"); setMode("live");
    const marker = `<!-- gremio:result:top:start id=${topId} -->`; const offset = content.indexOf(marker);
    if (offset >= 0) requestAnimationFrame(() => live.current?.focusRange(offset + marker.length + 1, offset + marker.length + 1));
  }

  const source = <div className="space-y-4">
    {analysis.prelude.length > 0 && <section className="space-y-2"><h2 className="text-sm font-semibold text-slate-700">Vor dem ersten TOP</h2>{analysis.prelude.map(block => <SourceBlock key={block.id} block={block} selected={selected.has(block.id)} onToggle={() => toggle(block)} />)}</section>}
    {analysis.tops.map(top => <section key={top.id} id={`source-${top.id}`} className={`space-y-2 rounded-xl border-2 p-3 ${top.blocks.some(block => selected.has(block.id)) ? "border-brand-300 bg-brand-50/50" : "border-slate-300 bg-slate-50"}`}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-800">{top.title}</h2><p className={`text-xs font-medium ${top.blocks.some(block => selected.has(block.id)) ? "text-brand-800" : "text-slate-600"}`}>{top.blocks.some(block => selected.has(block.id)) ? "Enthält ausgewählte Blöcke" : "Nicht im Ergebnis"}</p>{!top.blocks.some(block => block.automatic) && <p className="text-xs text-amber-700">Kein Ergebnis erkannt</p>}</div>{top.blocks.some(block => selected.has(block.id)) && <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => jumpToTop(top.id)}>Im Ergebnis zeigen</button>}</div>
      {top.blocks.map(block => <SourceBlock key={block.id} block={block} selected={selected.has(block.id)} onToggle={() => toggle(block)} />)}
      {!top.blocks.length && <p className="rounded bg-white p-3 text-sm text-slate-500">Dieser TOP enthält keine auswählbaren Inhaltsblöcke.</p>}
    </section>)}
    {!analysis.tops.length && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Keine TOP-Überschrift erkannt. Blöcke können trotzdem einzeln übernommen werden.</p>}
  </div>;

  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-100" data-result-protocol-workspace onKeyDownCapture={event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); void save(); }
    else if (["b", "i", "u"].includes(key) && mode !== "preview" && (event.target as Element).closest("[data-result-document]")) { event.preventDefault(); command(key === "b" ? "bold" : key === "i" ? "italic" : "underline"); }
  }}>
    <header className="z-20 shrink-0 border-b border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <Link href={backHref} className="rounded px-1 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={event => { if (!dirty) return; event.preventDefault(); setConfirmation({ type: "leave", href: backHref }); }}>← Protokoll</Link>
        <div className="min-w-[12rem] flex-1"><h1 className="text-sm font-semibold">{filename}</h1><p className="text-xs text-slate-400">Sitzung {folderName}</p></div>
        <span role="status" className={`text-xs ${message.error ? "text-red-700" : dirty ? "text-amber-700" : "text-slate-500"}`}>{saving ? "Speichert …" : loading ? "Lädt …" : message.error ? "Bitte prüfen" : !persisted ? "Ungespeicherter Entwurf" : dirty ? "Ungespeichert" : "Gespeichert"}</span>
        <button type="button" className="btn-primary btn-sm !h-8 !px-3 !text-[13px]" disabled={busy} onClick={() => void save()}>{persisted ? "Speichern" : "Als Ergebnisprotokoll speichern"}</button>
        <button type="button" className="btn-secondary btn-sm !h-8 !px-3 !text-[13px]" disabled={busy || !persisted} onClick={() => void reload()}>Neu laden</button>
        <ProtocolExportButton compact areaId={areaId} sourceName={filename} logos={logos} disabled={!persisted || dirty || busy} action={exportAction} />
      </div>
      <MarkdownToolbar disabled={mode === "preview" || busy} onCommand={command} onCapture={capture} leading={<div className="flex rounded-md bg-slate-100 p-0.5" role="group" aria-label="Ergebnisansicht">{(["live", "edit", "preview"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onMouseDown={capture} onClick={() => setMode(value)} className={`min-h-8 rounded px-3 py-1.5 text-[13px] ${mode === value ? "bg-white font-medium text-brand-700 shadow-sm" : "text-slate-500"}`}>{value === "live" ? "Live Vorschau" : value === "edit" ? "Bearbeiten" : "Vorschau"}</button>)}</div>} />
      <div className="flex border-t border-slate-200 md:hidden" role="tablist" aria-label="Arbeitsansicht"><button type="button" role="tab" aria-selected={mobilePane === "source"} className={`flex-1 px-3 py-2 text-sm ${mobilePane === "source" ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`} onClick={() => setMobilePane("source")}>Quelle</button><button type="button" role="tab" aria-selected={mobilePane === "result"} className={`flex-1 px-3 py-2 text-sm ${mobilePane === "result" ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`} onClick={() => setMobilePane("result")}>Ergebnis</button></div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-xs text-slate-600"><span>{selectedBlocks} Ergebnisblöcke aus {selectedTops} TOPs ausgewählt</span><span>Für {topsWithoutAutomatic} von {analysis.tops.length} TOPs wurde kein Ergebnis erkannt</span></div>
      {(message.error || message.success) && <div role={message.error ? "alert" : "status"} className={`border-t px-4 py-2 text-xs ${message.error ? "border-red-100 bg-red-50 text-red-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}>{message.error ?? message.success}</div>}
    </header>
    <main className="grid min-h-0 flex-1 md:grid-cols-2">
      <section ref={sourcePane} aria-label="Quelle" onScroll={() => { if (sourcePane.current && resultPane.current) syncScroll(sourcePane.current, resultPane.current); }} className={`${mobilePane === "source" ? "block" : "hidden"} min-h-0 overflow-y-auto border-r border-slate-300 p-3 sm:p-5 md:block`}><div className="mx-auto max-w-3xl"><h2 className="mb-3 text-sm font-semibold text-slate-700">Quelle · schreibgeschützt</h2>{source}<div aria-hidden="true" data-document-end-space className="h-[45dvh] min-h-48 max-h-[32rem]" /></div></section>
      <section ref={resultPane} aria-label="Ergebnis" onScroll={() => { if (resultPane.current && sourcePane.current) syncScroll(resultPane.current, sourcePane.current); }} data-result-document className={`${mobilePane === "result" ? "block" : "hidden"} min-h-0 overflow-y-auto p-3 sm:p-5 md:block`}><div className="mx-auto max-w-3xl">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Ergebnis · bearbeitbar</h2>
        {mode !== "edit" ? <MarkdownLiveEditor ref={live} markdown={content} readOnly={mode === "preview" || loading} onChange={change} /> : <textarea ref={textarea} aria-label="Ergebnisprotokoll Markdown" readOnly={loading} spellCheck={false} className="min-h-[70vh] w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white p-5 font-mono text-sm leading-6 outline-none focus:border-slate-400" value={content} onSelect={capture} onChange={event => { selection.current = { start: event.target.selectionStart, end: event.target.selectionEnd }; change(event.target.value); }} onKeyDown={event => { if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return; event.preventDefault(); const next = indentMarkdown(content, capture(), event.shiftKey); change(next.markdown, next.selection); }} />}
        <p className="mt-3 text-xs text-slate-400">Die Quelle bleibt unverändert. Speichern schreibt ausschließlich {filename} in Nextcloud.</p>
        <div aria-hidden="true" data-document-end-space className="h-[45dvh] min-h-48 max-h-[32rem]" />
      </div></section>
    </main>
    <ConfirmDialog open={!!confirmation} title={confirmation?.type === "block" ? "Bearbeiteten Block entfernen?" : "Ungespeicherte Änderungen"} message={confirmation?.type === "block" ? "Dieser übernommene Quellblock wurde im Ergebnisprotokoll verändert. Beim Entfernen geht diese Fassung aus dem aktuellen Entwurf verloren." : confirmation?.type === "reload" ? "Ungespeicherte Änderungen verwerfen und die Ergebnisdatei neu laden?" : "Es gibt ungespeicherte Änderungen. Ergebnisprotokoll wirklich verlassen?"} confirmLabel={confirmation?.type === "block" ? "Bearbeiteten Block entfernen" : confirmation?.type === "reload" ? "Verwerfen und neu laden" : "Verwerfen und verlassen"} disabled={busy} onClose={() => setConfirmation(null)} onConfirm={() => { if (confirmation?.type === "block") confirmRemoval(); else if (confirmation?.type === "reload") { setConfirmation(null); void reload(true); } else if (confirmation?.type === "leave") { allowUnload.current = true; window.location.assign(confirmation.href); } }} />
  </div>;
}
