// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MarkdownLiveEditor, type MarkdownLiveEditorHandle } from "./MarkdownLiveEditor";
import { ProtocolFinancePanel, type ProtocolSuggestion } from "@/components/protocols/ProtocolFinancePanel";
import { ProtocolMembersPanel } from "@/components/protocols/ProtocolMembersPanel";
import { ProtocolGuestsPanel } from "@/components/protocols/ProtocolGuestsPanel";
import { ProtocolMetadataPanel } from "@/components/protocols/ProtocolMetadataPanel";
import { ProtocolExportButton } from "@/components/protocols/ProtocolExportButton";
import { type ProtocolLogo } from "@/lib/protocol-logos";
import type { ProtocolMember, ProtocolMemberCommand, ProtocolMemberResult } from "@/lib/protocol-members";
import type { ProtocolGuest, ProtocolGuestCommand, ProtocolGuestResult } from "@/lib/protocol-guests";
import type { ProtocolExportInput, ProtocolExportResult } from "@/lib/protocol-export";
import { extractFinanceLinks, formatFinanceBlock, getMarkdownHeadings, hasManagedAgenda, isAttendanceSectionIncluded, setAttendanceSectionIncluded, syncProtocolAttendance, upsertAgenda, type AttendanceSection } from "@/lib/protocol-markdown";
import { markdownLineAt, markdownLineStart, remapMarkdownOffset } from "@/lib/protocol-live-editor";
import { insertMarkdownImage, markdownImageUrl, type MarkdownImageUploadResult } from "@/lib/markdown-images";
import { formatMarkdown, indentMarkdown, type MarkdownCommand, type MarkdownSelection } from "@/lib/markdown-formatting";
import { textareaDropCaret, type TextareaDropCaret } from "@/lib/textarea-drop-caret";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { DocumentOutline } from "./DocumentOutline";
import { DocumentDialog } from "./DocumentDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { DocumentSearch } from "./DocumentSearch";

type SaveResult = { content?: string; error?: string; success?: string; savedToNextcloud?: boolean };
export type DocumentProtocolTools = {
  decisionTemplate?: string;
  areaId: number; members: ProtocolMember[]; guests: ProtocolGuest[]; suggestions: ProtocolSuggestion[]; hasLinkedBoard: boolean; cardBaseUrl: string; logos: ProtocolLogo[];
  memberAction: (command: ProtocolMemberCommand) => Promise<ProtocolMemberResult>;
  guestAction: (command: ProtocolGuestCommand) => Promise<ProtocolGuestResult>;
  exportAction: (input: ProtocolExportInput) => Promise<ProtocolExportResult>;
};
type Snapshot = { markdown: string; selection: MarkdownSelection };

export function DocumentEditor({ initialContent, filename, backHref, contextLabel, saveAction, reloadAction, protocol, images }: {
  initialContent: string; filename: string; backHref: string; contextLabel: string;
  saveAction: (content: string, replanned?: number[]) => Promise<SaveResult>;
  reloadAction: () => Promise<{ content?: string; error?: string; members?: ProtocolMember[]; guests?: ProtocolGuest[] }>;
  protocol?: DocumentProtocolTools;
  images?: { areaId: number; sessionId: number; subfolder: string; uploadAction: (data: FormData) => Promise<MarkdownImageUploadResult> };
}) {
  const [members, setMembers] = useState(protocol?.members ?? []);
  const [guests, setGuests] = useState(protocol?.guests ?? []);
  const attendance = (text: string, rows = members, visitors = guests) => protocol ? syncProtocolAttendance(text, rows, visitors) : text;
  const normalize = (text: string) => { const next = attendance(text); return protocol && hasManagedAgenda(next) ? upsertAgenda(next) : next; };
  const [content, setContent] = useState(() => attendance(initialContent));
  const [savedContent, setSavedContent] = useState(initialContent);
  const [mode, setMode] = useState<"live" | "edit" | "preview">("live");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageAnchor = useRef<{ source: string; selection: MarkdownSelection } | undefined>(undefined);
  const imageUploadPending = useRef(false);
  const [state, setState] = useState<SaveResult>({});
  const [membersBusy, setMembersBusy] = useState(false);
  const [guestsBusy, setGuestsBusy] = useState(false);
  const [guestsDirty, setGuestsDirty] = useState(false);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const headerToggle = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRevision, setSearchFocusRevision] = useState(0);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [tab, setTab] = useState<"outline" | "finance">(protocol?.hasLinkedBoard ? "finance" : "outline");
  const [activeLine, setActiveLine] = useState(0);
  const [tops, setTops] = useState<Record<number, string>>({});
  const [replanned, setReplanned] = useState<Record<number, number>>({});
  const revision = useRef(0);
  const [confirmation, setConfirmation] = useState<{ message: string; confirmLabel: string; action: () => void } | null>(null);
  const allowUnload = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const live = useRef<MarkdownLiveEditorHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sidebarScroll = useRef<HTMLDivElement>(null);
  const selection = useRef<MarkdownSelection>({ start: 0, end: 0 });
  const focus = useRef<MarkdownSelection | null>(null);
  const history = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const dragged = useRef<number | null>(null);
  const [drop, setDrop] = useState<TextareaDropCaret | null>(null);
  const [viewportHeight, setViewportHeight] = useState<string>("100dvh");
  const linkedIds = useMemo(() => new Set(protocol ? extractFinanceLinks(content).map(link => link.cardId) : []), [content, protocol]);
  const busy = saving || loading || membersBusy || guestsBusy || uploadingImage;
  const formDirty = guestsDirty || metadataDirty;
  const dirty = content !== savedContent || formDirty || Object.keys(replanned).length > 0;

  useEffect(() => {
    // The editor has one document viewport, including above the mobile keyboard.
    const viewport = window.visualViewport;
    const resize = () => setViewportHeight(viewport ? `${viewport.height}px` : "100dvh");
    resize(); viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty && !allowUnload.current) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a[href]");
      if (dirty && link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0 && link.getAttribute("target") !== "_blank" && !link.getAttribute("href")?.startsWith("#")) {
        event.preventDefault(); event.stopPropagation();
        const href = (link as HTMLAnchorElement).href;
        setConfirmation({ message: "Es gibt ungespeicherte Änderungen. Dokument wirklich verlassen?", confirmLabel: "Verwerfen und verlassen", action: () => { allowUnload.current = true; window.location.assign(href); } });
      }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  useEffect(() => { if (sidebarScroll.current) sidebarScroll.current.scrollTop = 0; }, [tab]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (event.defaultPrevented || sessionOpen || document.querySelector('[aria-modal="true"]') || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault(); openSearch();
    };
    // Also handles Cmd/Ctrl+F before any editor element has received focus.
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  });

  useLayoutEffect(() => {
    const node = editor.current;
    if (mode === "edit" && node) {
      const fit = () => {
        const wrapper = node.parentElement!; wrapper.style.minHeight = `${node.offsetHeight}px`;
        node.style.height = "0px"; node.style.height = `${node.scrollHeight + 2}px`; wrapper.style.minHeight = "";
      };
      fit(); let width = node.clientWidth;
      const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; fit(); } });
      observer.observe(node);
      if (focus.current) { node.focus({ preventScroll: true }); node.setSelectionRange(focus.current.start, focus.current.end); focus.current = null; }
      return () => observer.disconnect();
    }
    if (mode === "live" && focus.current) { live.current?.focusRange(focus.current.start, focus.current.end); focus.current = null; }
  }, [content, mode]);

  function capture() {
    if (mode === "edit" && editor.current) selection.current = { start: editor.current.selectionStart, end: editor.current.selectionEnd };
    else if (mode === "live") selection.current = live.current?.selection() ?? selection.current;
    return selection.current;
  }
  function openSearch() { capture(); setSearchOpen(true); setSearchFocusRevision(value => value + 1); setMobileSidebar(false); }
  function closeSearch() { setSearchOpen(false); searchButton.current?.focus(); }
  function change(next: string, range?: MarkdownSelection, remember = true) {
    if (next !== content && remember) { history.current.push({ markdown: content, selection: { ...selection.current } }); if (history.current.length > 100) history.current.shift(); future.current = []; }
    if (range) { selection.current = range; focus.current = range; }
    setContent(next); setState({});
  }
  const latestImageDocument = useRef({ content, change });
  latestImageDocument.current = { content, change };
  async function uploadImage(file: File) {
    if (!images || imageUploadPending.current) return;
    if (!file.size || file.size > 5 * 1024 * 1024) { setState({ error: "Bitte ein Bild mit maximal 5 MB auswählen." }); return; }
    const anchor = imageAnchor.current ?? { source: content, selection: capture() };
    imageAnchor.current = undefined;
    imageUploadPending.current = true; setUploadingImage(true);
    try {
      const data = new FormData(); data.set("file", file);
      const result = await images.uploadAction(data);
      if (!result.reference) { setState({ error: result.error ?? "Das Bild konnte nicht hochgeladen werden." }); return; }
      const latest = latestImageDocument.current;
      const range = { start: remapMarkdownOffset(anchor.source, latest.content, anchor.selection.start), end: remapMarkdownOffset(anchor.source, latest.content, anchor.selection.end) };
      const edit = insertMarkdownImage(latest.content, range, result.reference, result.alt ?? "Bild");
      latest.change(edit.markdown, edit.selection);
    } catch { setState({ error: "Bild-Upload konnte nicht bestätigt werden. Bitte den attachments-Ordner prüfen." }); }
    finally { imageUploadPending.current = false; setUploadingImage(false); }
  }
  function command(value: MarkdownCommand) {
    if (mode === "preview" || busy) return;
    const result = formatMarkdown(content, capture(), value);
    change(result.markdown, result.selection);
  }
  function jump(line: number) {
    setActiveLine(line); setMobileSidebar(false);
    const offset = markdownLineStart(content, line); selection.current = { start: offset, end: offset };
    if (mode === "edit" && editor.current) {
      const node = editor.current; node.focus({ preventScroll: true }); node.setSelectionRange(offset, offset);
      // A hidden mirror gives the actual wrapped line height, rather than a line-count estimate.
      const mirror = document.createElement("div"); const style = getComputedStyle(node);
      mirror.style.cssText = `position:absolute;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;width:${node.clientWidth}px;font:${style.font};line-height:${style.lineHeight};padding:${style.padding};`;
      mirror.textContent = content.slice(0, offset) + "\u200b"; document.body.appendChild(mirror);
      const height = mirror.getBoundingClientRect().height; mirror.remove();
      scroller.current?.scrollTo({ top: node.offsetTop + height - 80, behavior: "smooth" });
    } else requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-markdown-line="${line}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  function trackScroll() {
    if (mode === "edit") return;
    const root = scroller.current; if (!root) return;
    const top = root.getBoundingClientRect().top + 90;
    const headings = getMarkdownHeadings(content);
    let current = 0;
    for (const heading of headings) { const node = root.querySelector<HTMLElement>(`[data-markdown-line="${heading.line}"]`); if (node && node.getBoundingClientRect().top <= top) current = heading.line; }
    setActiveLine(current);
  }
  function clearDrop() { dragged.current = null; setDrop(null); live.current?.clearDrop(); }
  function insertCard(card: ProtocolSuggestion, offset?: number) {
    if (busy || !protocol || !tops[card.id]?.trim() || linkedIds.has(card.id) || mode === "preview") return;
    const range = capture(); const from = offset ?? range.start; const to = offset ?? range.end;
    const block = `${from ? "\n\n" : ""}${formatFinanceBlock(card, tops[card.id], `${protocol.cardBaseUrl}/${card.id}`, protocol.decisionTemplate)}\n`;
    setReplanned(current => ({ ...current, [card.id]: ++revision.current }));
    change(normalize(content.slice(0, from) + block + content.slice(to)), { start: from + block.length, end: from + block.length });
    setMobileSidebar(false);
  }
  function removeCard(id: number) {
    const expression = new RegExp(`\\n?<!-- gremio:finance:start card=${id} -->[\\s\\S]*?<!-- gremio:finance:end card=${id} -->\\n?`, "g");
    const next = content.replace(expression, "\n");
    if (next === content) return setState({ error: "Der Finanzblock wurde manuell verändert. Bitte den zugehörigen Block im Dokument entfernen." });
    setReplanned(current => { const next = { ...current }; delete next[id]; return next; }); change(normalize(next));
  }
  async function save() {
    if (busy || formDirty) return;
    setSaving(true); const snapshot = { ...replanned };
    try {
      const submitted = normalize(content);
      const result = await saveAction(submitted, Object.keys(snapshot).map(Number).filter(id => linkedIds.has(id)));
      setState(result);
      if (result.savedToNextcloud) {
        const saved = result.content ?? submitted; setSavedContent(saved); setContent(current => current === content ? saved : current);
        if (!result.error) setReplanned(current => { const next = { ...current }; for (const id of Object.keys(snapshot).map(Number)) if (next[id] === snapshot[id]) delete next[id]; return next; });
      }
    } catch { setState({ error: "Speichern konnte nicht bestätigt werden. Bitte erneut versuchen." }); }
    finally { setSaving(false); }
  }
  async function reload(confirmed = false) {
    if (busy) return;
    if (dirty && !confirmed) { setConfirmation({ message: "Ungespeicherte Änderungen verwerfen und die Datei neu laden?", confirmLabel: "Verwerfen und neu laden", action: () => { void reload(true); } }); return; }
    setLoading(true);
    try {
      const result = await reloadAction(); if (result.error || result.content === undefined) return setState({ error: result.error ?? "Laden fehlgeschlagen." });
      const rows = result.members ?? members; const visitors = result.guests ?? guests;
      setMembers(rows); setGuests(visitors); setContent(attendance(result.content, rows, visitors)); setSavedContent(result.content); setReplanned({}); history.current = []; future.current = []; setState({ success: "Aktueller Nextcloud-Stand geladen." });
    } catch { setState({ error: "Die Datei konnte nicht neu geladen werden." }); } finally { setLoading(false); }
  }
  function attendanceToggle(section: AttendanceSection) {
    const included = isAttendanceSectionIncluded(content, section);
    return <button type="button" disabled={busy} className="mt-4 text-sm text-brand-600 hover:underline disabled:opacity-40" onClick={() => change(normalize(setAttendanceSectionIncluded(content, section, !included)))}>{included ? "Aus Protokoll entfernen" : "Zum Protokoll hinzufügen"}</button>;
  }

  return <div className="flex flex-col overflow-hidden bg-slate-100" style={{ height: viewportHeight }} data-document-workspace onKeyDownCapture={event => {
    if (sessionOpen || confirmation || document.querySelector('[aria-modal="true"]') || !event.ctrlKey && !event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); void save(); return; }
    if (loading || !(event.target as Element).closest('[data-document-content]') || mode === "preview") return;
    if (["b", "i", "u"].includes(key)) { event.preventDefault(); event.stopPropagation(); command(key === "b" ? "bold" : key === "i" ? "italic" : "underline"); }
    if (["z", "y"].includes(key)) {
      event.preventDefault(); event.stopPropagation(); capture(); const backwards = key === "z" && !event.shiftKey;
      const source = backwards ? history.current : future.current; const target = backwards ? future.current : history.current;
      const snapshot = source.pop(); if (snapshot) { target.push({ markdown: content, selection: capture() }); change(snapshot.markdown, snapshot.selection, false); }
    }
  }}>
    <header className="z-20 shrink-0 border-b border-slate-200 bg-white shadow-sm">
      <div id="document-header-controls" hidden={headerCollapsed}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 sm:px-4">
        <Link href={backHref} className="rounded px-1 py-1 text-xs text-slate-500 hover:bg-slate-100" aria-label="Zurück zum Sitzungsordner">← <span className="hidden sm:inline">Ordner</span></Link>
        <div className="flex min-w-[8rem] flex-1 items-baseline gap-2 overflow-hidden" title={`${filename} · ${contextLabel}`}><h1 className="truncate text-sm font-semibold">{filename}</h1><p className="hidden truncate text-xs text-slate-400 lg:block">{contextLabel}</p></div>
        <span role="status" className={`text-xs ${state.error ? "text-red-700" : dirty ? "text-amber-700" : "text-slate-500"}`}>{saving ? "Speichert …" : loading ? "Lädt …" : state.error ? "Bitte prüfen" : dirty ? "Ungespeichert" : "Gespeichert"}</span>
        <button type="button" className="btn-primary btn-sm !h-8 !px-3 !text-[13px]" disabled={busy || formDirty} onClick={save}>Speichern</button>
        <button type="button" className="btn-secondary btn-sm !h-8 !px-3 !text-[13px]" disabled={busy || formDirty} onClick={() => void reload()}>Neu laden</button>
        {protocol && <ProtocolExportButton compact areaId={protocol.areaId} sourceName={filename} logos={protocol.logos} disabled={dirty || busy} action={protocol.exportAction} />}
        {protocol && <button type="button" onClick={() => setSessionOpen(true)} className={`btn-secondary btn-sm !h-8 !px-3 !text-[13px] ${formDirty ? "text-amber-700" : ""}`}>Sitzungsdaten{formDirty ? " •" : ""}</button>}
      </div>
      </div>
      <MarkdownToolbar disabled={mode === "preview" || busy} onCommand={command} onCapture={capture}
        leading={<>
        <div className="flex shrink-0 rounded-md bg-slate-100 p-0.5" role="group" aria-label="Editoransicht">{[["live", "Live Vorschau"], ["edit", "Bearbeiten"], ["preview", "Vorschau"]].map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={loading} onMouseDown={() => capture()} onClick={() => { change(normalize(content)); setMode(value as typeof mode); clearDrop(); }} className={`min-h-8 rounded px-3 py-1.5 text-[13px] ${mode === value ? "bg-white font-medium text-brand-700 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div>
        <button ref={searchButton} type="button" aria-label="Dokument durchsuchen" aria-expanded={searchOpen} aria-controls="document-search" title="Im Dokument suchen (Strg/Cmd+F)" onClick={openSearch} className={`flex min-h-8 shrink-0 items-center gap-1.5 px-2 text-[13px] ${searchOpen ? "text-brand-700" : "text-slate-500 hover:text-brand-700"}`}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>Suchen</button>
        </>}
        after={(images || protocol) && <>
          {images && <><button type="button" disabled={busy || mode === "preview"} className="min-h-8 shrink-0 px-2 text-[13px] text-slate-600 hover:text-brand-700 disabled:opacity-40" title="Bild auswählen und unter attachments ablegen (maximal 5 MB)" onMouseDown={event => { event.preventDefault(); capture(); }} onClick={() => { imageAnchor.current = { source: content, selection: { ...capture() } }; imageInput.current?.click(); }}>{uploadingImage ? "Bild lädt …" : "Bild einfügen"}</button><input ref={imageInput} type="file" aria-label="Bild auswählen" className="sr-only" accept="image/png,image/jpeg,image/gif,image/webp" tabIndex={-1} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadImage(file); }} /></>}
          {protocol && <button type="button" onClick={() => change(upsertAgenda(content))} disabled={busy} className="min-h-8 shrink-0 px-2 text-[13px] text-slate-600 hover:text-brand-700">Tagesordnung aktualisieren</button>}
        </>}
        trailing={<>
        <button type="button" aria-label={sidebarOpen ? "Werkzeuge ausblenden" : "Werkzeuge einblenden"} title={sidebarOpen ? "Werkzeuge ausblenden" : "Werkzeuge einblenden"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100 md:inline-flex"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg></button>
        <button type="button" aria-label={mobileSidebar ? "Schließen" : "Werkzeuge"} title={mobileSidebar ? "Werkzeuge schließen" : "Werkzeuge öffnen"} aria-expanded={mobileSidebar} onClick={() => setMobileSidebar(!mobileSidebar)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-brand-700 hover:bg-slate-100 md:hidden"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg></button>
          <button ref={headerToggle} type="button" aria-label={headerCollapsed ? "Kopfbereich einblenden" : "Kopfbereich ausblenden"} title={headerCollapsed ? "Kopfbereich einblenden" : "Kopfbereich ausblenden"} aria-expanded={!headerCollapsed} aria-controls="document-header-controls" onMouseDown={() => capture()} onClick={() => setHeaderCollapsed(value => !value)} className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-200 focus-visible:bg-slate-200 focus-visible:outline-none"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={headerCollapsed ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} /></svg></button>
        </>}
      />
      {searchOpen && <DocumentSearch content={content} mode={mode} scroller={scroller} editor={editor} focusRevision={searchFocusRevision} onClose={closeSearch} />}
      {(state.error || formDirty) && <div role="alert" className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">{state.error || "Bitte die Änderungen unter „Sitzungsdaten“ zuerst übernehmen oder abbrechen."}</div>}
    </header>
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div ref={scroller} data-document-content className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-16 sm:p-6" onScroll={() => { setDrop(null); trackScroll(); }} onPasteCapture={event => {
        if (!images || mode === "preview" || !(event.target instanceof Element) || !event.target.closest('[contenteditable="true"], textarea[aria-label="Markdown-Dokument"]')) return;
        const isImage = (file: File) => file.type.startsWith("image/") || (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name));
        const items = [...event.clipboardData.items].filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => !!file && isImage(file));
        const files = items.length ? items : [...event.clipboardData.files].filter(isImage);
        if (!files.length) return;
        // Intercept before the live editor pastes the clipboard's text/HTML fallback.
        event.preventDefault(); event.stopPropagation();
        if (files.length > 1) { setState({ error: "Bitte jeweils ein Bild aus der Zwischenablage einfügen." }); return; }
        if (busy || imageUploadPending.current) { setState({ error: "Bitte den laufenden Vorgang abwarten und das Bild dann erneut einfügen." }); return; }
        imageAnchor.current = { source: content, selection: { ...capture() } };
        void uploadImage(files[0]);
      }}>
        <div className="mx-auto max-w-[56rem]">
          {mode !== "edit" ? <MarkdownLiveEditor ref={live} markdown={content} readOnly={mode === "preview" || loading} imageUrl={images ? reference => markdownImageUrl(reference, images.areaId, images.sessionId, images.subfolder) : undefined} onChange={next => { capture(); change(next); }} onCommit={() => change(normalize(content))} onCardDrop={offset => { const card = protocol?.suggestions.find(card => card.id === dragged.current); if (card) insertCard(card, offset); clearDrop(); }} /> : <div className="relative">
            <textarea ref={editor} readOnly={loading} aria-label="Markdown-Dokument" spellCheck={false} className="block min-h-[60vh] w-full resize-none overflow-hidden rounded-md border border-slate-200 bg-white p-5 font-mono text-sm leading-6 outline-none focus:border-slate-300" value={content} onSelect={() => { capture(); setActiveLine(markdownLineAt(content, selection.current.start).index); }} onChange={e => { const range = { start: e.target.selectionStart, end: e.target.selectionEnd }; change(e.target.value); selection.current = range; }} onKeyDown={e => { if (loading || e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return; e.preventDefault(); const next = indentMarkdown(content, capture(), e.shiftKey); change(next.markdown, next.selection); }} onDragOver={e => {
              if (dragged.current === null) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy";
              const bounds = scroller.current!.getBoundingClientRect(); if (e.clientY < bounds.top + 40) scroller.current!.scrollTop -= 24; else if (e.clientY > bounds.bottom - 40) scroller.current!.scrollTop += 24;
              setDrop(textareaDropCaret(e.currentTarget, e.clientX, e.clientY));
            }} onDragLeave={() => setDrop(null)} onDrop={e => { if (dragged.current === null) return; e.preventDefault(); const card = protocol?.suggestions.find(card => card.id === dragged.current); const caret = textareaDropCaret(e.currentTarget, e.clientX, e.clientY); if (card && caret) insertCard(card, caret.offset); clearDrop(); }} />
            {drop && <span aria-hidden="true" data-protocol-drop-caret className="pointer-events-none absolute w-0.5 bg-brand-600" style={{ top: drop.top, left: drop.left, height: drop.height }} />}
          </div>}
          <p className="mt-3 text-xs text-slate-400">Speichern überschreibt diese Datei in Nextcloud, auch externe Änderungen.</p>
        </div>
      </div>
      <aside aria-label="Dokumentwerkzeuge" className={`${mobileSidebar ? "absolute inset-y-0 right-0 z-10 flex w-[min(24rem,100%)] shadow-xl" : "hidden"} ${sidebarOpen ? "md:relative md:flex md:w-80 md:shadow-none lg:w-96" : "md:hidden"} min-h-0 shrink-0 flex-col border-l border-slate-200 bg-slate-50`}>
        <div className="flex shrink-0 gap-1 border-b border-slate-200 p-3" role="tablist" aria-label="Dokumentwerkzeuge" onKeyDown={e => { if (!protocol?.hasLinkedBoard || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const next = e.key === "Home" ? "outline" : e.key === "End" ? "finance" : tab === "outline" ? "finance" : "outline"; setTab(next); e.currentTarget.querySelector<HTMLButtonElement>(`#document-${next}-tab`)?.focus(); }}>
          {(["outline", ...(protocol?.hasLinkedBoard ? ["finance"] : [])] as const).map(value => <button key={value} type="button" id={`document-${value}-tab`} role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} aria-controls={`document-${value}-panel`} onClick={() => setTab(value as typeof tab)} className={`rounded px-3 py-1.5 text-sm ${tab === value ? "bg-brand-50 font-medium text-brand-700" : "text-slate-500"}`}>{value === "outline" ? "Gliederung" : "Finanzanträge"}</button>)}
        </div>
        <div ref={sidebarScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
          <div role="tabpanel" id="document-outline-panel" aria-labelledby="document-outline-tab" hidden={tab !== "outline"}><DocumentOutline markdown={content} activeLine={activeLine} onJump={jump} /></div>
          {protocol?.hasLinkedBoard && <div role="tabpanel" id="document-finance-panel" aria-labelledby="document-finance-tab" hidden={tab !== "finance"}><ProtocolFinancePanel suggestions={protocol.suggestions} linkedIds={linkedIds} disabled={busy || mode === "preview"} tops={tops} onTop={(id, top) => setTops(current => ({ ...current, [id]: top }))} onInsert={insertCard} onRemove={removeCard} onJump={id => { const index = content.indexOf(`<!-- gremio:finance:start card=${id} -->`); if (index >= 0) jump(markdownLineAt(content, index).index + 1); }} onDrag={id => { capture(); dragged.current = id; }} onDragEnd={clearDrop} /></div>}
        </div>
      </aside>
    </div>
    {protocol && <DocumentDialog open={sessionOpen} onClose={() => setSessionOpen(false)}>
      <p className="text-xs text-slate-500">Mitglieder und Gäste werden für die Sitzung gespeichert. Änderungen am Protokoll anschließend über „Speichern“ nach Nextcloud übertragen.</p>
      <CollapsibleSection title="Mitglieder und Anwesenheit" defaultOpen><ProtocolMembersPanel members={members} action={protocol.memberAction} disabled={busy} onBusyChange={setMembersBusy} onChange={next => { setMembers(next); setContent(current => attendance(current, next)); }} />{attendanceToggle("members")}</CollapsibleSection>
      <CollapsibleSection title="Gäste"><ProtocolGuestsPanel guests={guests} action={protocol.guestAction} disabled={saving || membersBusy} onBusyChange={setGuestsBusy} onDirtyChange={setGuestsDirty} onChange={next => { setGuests(next); setContent(current => attendance(current, members, next)); }} />{attendanceToggle("guests")}</CollapsibleSection>
      <CollapsibleSection title="Sitzungsinformationen"><ProtocolMetadataPanel markdown={content} disabled={saving} onChange={next => change(next)} onDirtyChange={setMetadataDirty} /></CollapsibleSection>
      <div className="flex items-center justify-between gap-2 pt-2"><p className="text-xs text-slate-500">{formDirty ? "Es gibt noch nicht übernommene Formulareingaben." : "Die Eingaben bleiben auch beim Schließen erhalten."}</p><button type="button" className="btn-secondary btn-sm" onClick={() => setSessionOpen(false)}>Fertig</button></div>
    </DocumentDialog>}
    <ConfirmDialog open={!!confirmation} title="Ungespeicherte Änderungen" message={confirmation?.message ?? ""} confirmLabel={confirmation?.confirmLabel} disabled={busy} onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation?.action; setConfirmation(null); action?.(); }} />
  </div>;
}
