// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ProtocolState } from "@/app/intern/protokolle/actions";
import { textareaDropCaret, type TextareaDropCaret } from "@/lib/textarea-drop-caret";
import { ProtocolMembersPanel } from "@/components/protocols/ProtocolMembersPanel";
import { ProtocolGuestsPanel } from "@/components/protocols/ProtocolGuestsPanel";
import { ProtocolLiveEditor, type ProtocolLiveEditorHandle } from "@/components/protocols/ProtocolLiveEditor";
import { ProtocolMarkdownPreview, protocolPreviewClassName } from "@/components/protocols/ProtocolMarkdownPreview";
import { ProtocolMetadataPanel } from "@/components/protocols/ProtocolMetadataPanel";
import { ProtocolExportButton } from "@/components/protocols/ProtocolExportButton";
import type { ProtocolLogo } from "@/lib/protocol-logos";
import type { ProtocolExportInput, ProtocolExportResult } from "@/lib/protocol-export";
import type { ProtocolGuest, ProtocolGuestCommand, ProtocolGuestResult } from "@/lib/protocol-guests";
import type { ProtocolMember, ProtocolMemberCommand, ProtocolMemberResult } from "@/lib/protocol-members";
import {
  extractFinanceLinks,
  formatFinanceBlock,
  hasManagedAgenda,
  upsertAgenda,
  syncProtocolAttendance,
  isAttendanceSectionIncluded,
  setAttendanceSectionIncluded,
  type AttendanceSection,
} from "@/lib/protocol-markdown";

type Suggestion = {
  id: number;
  number: string | null;
  title: string;
  applicant: string;
  amount: number | null;
  priority: string | null;
  assignedSession: string | null;
};

export function ProtocolEditor({
  initialContent,
  suggestions,
  hasLinkedBoard,
  cardBaseUrl,
  saveAction,
  reloadAction,
  initialMembers,
  memberAction,
  initialGuests,
  guestAction,
  emptyState,
  exportConfig,
}: {
  initialContent: string | null;
  suggestions: Suggestion[];
  hasLinkedBoard: boolean;
  cardBaseUrl: string;
  saveAction: (content: string, replannedCardIds?: number[]) => Promise<ProtocolState>;
  reloadAction: () => Promise<{ content?: string; etag?: string; error?: string; members?: ProtocolMember[]; guests?: ProtocolGuest[] }>;
  initialMembers: ProtocolMember[];
  memberAction: (command: ProtocolMemberCommand) => Promise<ProtocolMemberResult>;
  initialGuests: ProtocolGuest[];
  guestAction: (command: ProtocolGuestCommand) => Promise<ProtocolGuestResult>;
  emptyState?: React.ReactNode;
  exportConfig?: { areaId: number; sourceName: string; logos: ProtocolLogo[]; action: (input: ProtocolExportInput) => Promise<ProtocolExportResult> };
}) {
  const hasDocument = initialContent !== null;
  const [members, setMembers] = useState(initialMembers);
  const [guests, setGuests] = useState(initialGuests);
  const withAttendance = (text: string, rows: ProtocolMember[], guestRows = guests) => syncProtocolAttendance(text, rows, guestRows);
  const [content, setContent] = useState(() => hasDocument ? withAttendance(initialContent, initialMembers, initialGuests) : "");
  const [savedContent, setSavedContent] = useState(initialContent ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedSidebarTab, setSidebarTab] = useState<"finance" | "members" | "guests" | "metadata">(hasLinkedBoard ? "finance" : "members");
  const sidebarTab = !hasLinkedBoard && selectedSidebarTab === "finance" ? "members" : selectedSidebarTab;
  const [membersBusy, setMembersBusy] = useState(false);
  const [guestsBusy, setGuestsBusy] = useState(false);
  const [guestsDirty, setGuestsDirty] = useState(false);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [state, setState] = useState<ProtocolState>({});
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"live" | "edit" | "preview">("live");
  const preview = mode === "preview";
  const [tops, setTops] = useState<Record<number, string>>({});
  const [replannedCards, setReplannedCards] = useState<Record<number, number>>({});
  const planningRevision = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const liveEditor = useRef<ProtocolLiveEditorHandle>(null);
  const draggedCard = useRef<number | null>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const [dropCaret, setDropCaret] = useState<TextareaDropCaret | null>(null);
  const dirty = content !== savedContent || guestsDirty || metadataDirty || Object.keys(replannedCards).length > 0;
  const saveFailed = !!state.error && !state.savedToNextcloud;
  const linkedIds = useMemo(() => new Set(extractFinanceLinks(content).map((link) => link.cardId)), [content]);
  const orderedSuggestions = useMemo(() => [...suggestions].sort((a, b) => Number(linkedIds.has(a.id)) - Number(linkedIds.has(b.id))), [suggestions, linkedIds]);

  useEffect(() => {
    setMembers(initialMembers);
    setGuests(initialGuests);
    if (hasDocument) setContent(current => syncProtocolAttendance(current, initialMembers, initialGuests));
  }, [initialMembers, initialGuests, hasDocument]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!dirty) return;
      const link = (event.target as Element | null)?.closest("a[href]");
      if (link && !window.confirm("Es gibt ungespeicherte Änderungen. Seite wirklich verlassen?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);

  function update(next: string) {
    next = withAttendance(next, members);
    setContent(hasManagedAgenda(next) ? upsertAgenda(next) : next);
    setState({});
  }

  function insertCard(card: Suggestion, dropOffset?: number) {
    const top = (tops[card.id] ?? "").trim();
    if (!top) {
      setState({ error: "Bitte zuerst eine TOP-Nummer für den Finanzantrag angeben." });
      return;
    }
    if (linkedIds.has(card.id)) {
      setState({ error: "Dieser Finanzantrag ist im Protokoll bereits verknüpft." });
      return;
    }
    const block = formatFinanceBlock(card, top, `${cardBaseUrl}/${card.id}`);
    const revision = ++planningRevision.current;
    setReplannedCards(current => ({ ...current, [card.id]: revision }));
    const node = textarea.current;
    if (mode === "live") {
      const selection = liveEditor.current?.selection();
      const start = dropOffset ?? selection?.start ?? content.length;
      const end = dropOffset ?? selection?.end ?? start;
      const inserted = `${start ? "\n\n" : ""}${block}\n`;
      update(`${content.slice(0, start)}${inserted}${content.slice(end)}`);
      requestAnimationFrame(() => liveEditor.current?.focusAt(start + inserted.length));
      return;
    }
    if (!node) return update(`${content.trimEnd()}\n\n${block}\n`);
    const start = dropOffset ?? node.selectionStart;
    const end = dropOffset ?? node.selectionEnd;
    update(`${content.slice(0, start)}${start ? "\n\n" : ""}${block}\n${content.slice(end)}`);
    requestAnimationFrame(() => node.focus());
  }

  function clearDropCaret() {
    dragPoint.current = null;
    setDropCaret(null);
    liveEditor.current?.clearDrop();
  }

  function removeCard(cardId: number) {
    const exact = new RegExp(`\\n?<!-- gremio:finance:start card=${cardId} -->[\\s\\S]*?<!-- gremio:finance:end card=${cardId} -->\\n?`, "g");
    const next = content.replace(exact, "\n");
    if (next === content) {
      setState({ error: "Der verwaltete Block wurde manuell verändert. Entferne den gesamten Finanzantragsblock beziehungsweise den Link zur Gremio-Karte direkt im Editor und speichere erneut." });
      return;
    }
    setReplannedCards(current => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    update(next);
  }

  async function save() {
    if (membersBusy || guestsBusy || guestsDirty || metadataDirty) return;
    setSaving(true);
    try {
      const attendance = withAttendance(content, members);
      const submittedContent = hasManagedAgenda(attendance) ? upsertAgenda(attendance) : attendance;
      const planningSnapshot = { ...replannedCards };
      const result = await saveAction(submittedContent, Object.keys(planningSnapshot).map(Number).filter(id => linkedIds.has(id)));
      setState(result);
      if (result.savedToNextcloud) {
        const saved = result.content ?? submittedContent;
        setSavedContent(saved);
        setContent(current => current === content ? saved : current);
        if (!result.error) setReplannedCards(current => {
          const next = { ...current };
          for (const id of Object.keys(planningSnapshot).map(Number)) {
            if (next[id] === planningSnapshot[id]) delete next[id];
          }
          return next;
        });
      }
    } catch {
      setState({ error: "Speichern konnte nicht bestätigt werden. Bitte die Verbindung prüfen und erneut speichern." });
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen und Nextcloud neu laden?")) return;
    const result = await reloadAction();
    if (result.error) return setState({ error: result.error });
    const currentMembers = result.members ?? members;
    const currentGuests = result.guests ?? guests;
    setMembers(currentMembers);
    setGuests(currentGuests);
    setContent(withAttendance(result.content ?? "", currentMembers, currentGuests));
    setSavedContent(result.content ?? "");
    setReplannedCards({});
    setState({ success: "Aktueller Nextcloud-Stand geladen." });
  }

  function attendanceToggle(section: AttendanceSection) {
    const included = isAttendanceSectionIncluded(content, section);
    const title = section === "members" ? "Mitglieder" : "Gäste";
    return <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <button type="button" className="btn-secondary btn-sm" disabled={!hasDocument || saving || membersBusy || guestsBusy} onClick={() => {
        if (included && !window.confirm(`Abschnitt „${title}“ aus dem Protokoll entfernen? Auch eigene Notizen innerhalb dieses Abschnitts werden entfernt. Die Personen und ihre Daten in der Seitenleiste bleiben erhalten.`)) return;
        setContent(current => {
          const next = withAttendance(setAttendanceSectionIncluded(current, section, !included), members);
          return hasManagedAgenda(next) ? upsertAgenda(next) : next;
        });
        setState({});
      }}>{included ? "Aus Protokoll entfernen" : "Zum Protokoll hinzufügen"}</button>
      <p className="text-xs text-slate-500">{!hasDocument ? "Bitte zuerst ein Protokoll erstellen oder öffnen. " : included ? "Abschnitt ist im Protokoll enthalten. " : ""}Die Änderung anschließend in Nextcloud speichern.</p>
    </div>;
  }

  const sidebarToggle = (
    <button
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      aria-label={sidebarOpen ? "Seitenleiste einklappen" : "Seitenleiste öffnen"}
      title={sidebarOpen ? "Seitenleiste einklappen" : "Seitenleiste öffnen"}
      aria-expanded={sidebarOpen}
      aria-controls="protocol-sidebar"
      onClick={() => setSidebarOpen(open => !open)}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M15 3v18" />
        {sidebarOpen && <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4Z" fill="currentColor" fillOpacity="0.18" stroke="none" />}
      </svg>
    </button>
  );

  return (
    <div className={`grid gap-5 ${sidebarOpen ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
      {hasDocument ? (
      <section className="card min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([ ["live", "Live Vorschau"], ["edit", "Bearbeiten"], ["preview", "Vorschau"] ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} className={mode === value ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => { update(content); clearDropCaret(); setMode(value); }}>{label}</button>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => update(upsertAgenda(content))}>Tagesordnung aktualisieren</button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className={`text-sm ${saveFailed ? "text-red-700" : dirty ? "text-amber-700" : "text-green-700"}`}>
              {saving ? "Speichert…" : saveFailed ? "Nicht gespeichert" : dirty ? "Ungespeichert" : "Gespeichert"}
            </span>
            {sidebarToggle}
          </div>
        </div>
        {mode === "live" ? (
          <ProtocolLiveEditor ref={liveEditor} markdown={content} onChange={next => { setContent(next); setState({}); }} onCommit={() => update(content)} onCardDrop={offset => {
            const card = suggestions.find(item => item.id === draggedCard.current);
            draggedCard.current = null;
            if (card) insertCard(card, offset);
          }} />
        ) : preview ? (
          <div className={protocolPreviewClassName}><ProtocolMarkdownPreview markdown={content} /></div>
        ) : (
          <div className="relative">
            <textarea
              ref={textarea}
              aria-label="Markdown-Protokoll"
              className="input block min-h-[38rem] resize-y font-mono text-sm leading-6"
              value={content}
              style={dropCaret ? { caretColor: "transparent" } : undefined}
              onChange={(event) => update(event.target.value)}
              onDragOver={(event) => {
                if (draggedCard.current === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                const node = event.currentTarget;
                const bounds = node.getBoundingClientRect();
                if (event.clientY < bounds.top + 28) node.scrollTop -= 24;
                else if (event.clientY > bounds.bottom - 28) node.scrollTop += 24;
                dragPoint.current = { x: event.clientX, y: event.clientY };
                setDropCaret(textareaDropCaret(node, event.clientX, event.clientY));
              }}
              onScroll={(event) => {
                const point = dragPoint.current;
                if (point) setDropCaret(textareaDropCaret(event.currentTarget, point.x, point.y));
              }}
              onDragLeave={clearDropCaret}
              onDrop={(event) => {
                if (draggedCard.current === null) return;
                event.preventDefault();
                const card = suggestions.find((item) => item.id === draggedCard.current);
                const caret = textareaDropCaret(event.currentTarget, event.clientX, event.clientY);
                clearDropCaret();
                draggedCard.current = null;
                if (card && caret) insertCard(card, caret.offset);
                else setState({ error: "Einfügeposition konnte nicht ermittelt werden. Bitte den Einfügen-Button verwenden." });
              }}
            />
            {dropCaret && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <span data-protocol-drop-caret className="absolute w-0.5 bg-brand-600 ring-1 ring-white" style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }} />
              </div>
            )}
          </div>
        )}
        {(state.error || state.success) && (
          <div className={`mt-3 rounded-md p-3 text-sm ${state.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
            {state.error ?? state.success}
          </div>
        )}
        <p className="mt-3 text-xs text-amber-800">Speichern überschreibt die Protokolldatei in Nextcloud – auch zwischenzeitliche Änderungen außerhalb von Gremio.</p>
        {guestsDirty && <p className="mt-2 text-xs text-amber-800">Bitte die Gästedaten im Reiter „Gäste“ zuerst übernehmen oder abbrechen.</p>}
        {metadataDirty && <p className="mt-2 text-xs text-amber-800">Bitte die Sitzungsinformationen zuerst übernehmen oder abbrechen.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving || membersBusy || guestsBusy || guestsDirty || metadataDirty} className="btn-primary" onClick={save}>{saving ? "Speichert…" : "In Nextcloud speichern"}</button>
          <button type="button" disabled={saving || membersBusy || guestsBusy || guestsDirty || metadataDirty} className="btn-secondary" onClick={reload}>Neu laden</button>
          {exportConfig && <ProtocolExportButton {...exportConfig} disabled={dirty || saving || membersBusy || guestsBusy} />}
        </div>
      </section>
      ) : <section className="min-w-0"><div className="mb-3 flex justify-end">{sidebarToggle}</div>{emptyState ?? <p className="text-sm text-slate-500">Kein bearbeitbares Protokoll geladen.</p>}</section>}

      <aside id="protocol-sidebar" aria-label="Protokoll-Seitenleiste" hidden={!sidebarOpen} className="min-w-0 self-start rounded-lg border border-slate-200 bg-slate-50 p-3 xl:sticky xl:top-4">
        <div className="flex max-h-[calc(100dvh-4rem)] min-h-0 flex-col">
        <div className="mb-4 flex shrink-0 flex-wrap gap-1" role="tablist" aria-label="Seitenleistenbereiche" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const tabs: ("finance" | "members" | "guests" | "metadata")[] = hasLinkedBoard ? ["finance", "members", "guests", "metadata"] : ["members", "guests", "metadata"];
          const tab = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(sidebarTab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
          setSidebarTab(tab);
          event.currentTarget.querySelector<HTMLButtonElement>(`#protocol-${tab}-tab`)?.focus();
        }}>
          {hasLinkedBoard && <button type="button" id="protocol-finance-tab" role="tab" tabIndex={sidebarTab === "finance" ? 0 : -1} aria-selected={sidebarTab === "finance"} aria-controls="protocol-finance-panel" className={sidebarTab === "finance" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setSidebarTab("finance")}>Finanzanträge</button>}
          <button type="button" id="protocol-members-tab" role="tab" tabIndex={sidebarTab === "members" ? 0 : -1} aria-selected={sidebarTab === "members"} aria-controls="protocol-members-panel" className={sidebarTab === "members" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setSidebarTab("members")}>Mitglieder</button>
          <button type="button" id="protocol-guests-tab" role="tab" tabIndex={sidebarTab === "guests" ? 0 : -1} aria-selected={sidebarTab === "guests"} aria-controls="protocol-guests-panel" className={sidebarTab === "guests" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setSidebarTab("guests")}>Gäste</button>
          <button type="button" id="protocol-metadata-tab" role="tab" tabIndex={sidebarTab === "metadata" ? 0 : -1} aria-selected={sidebarTab === "metadata"} aria-controls="protocol-metadata-panel" className={sidebarTab === "metadata" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setSidebarTab("metadata")}>Sitzungsinformationen</button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain" data-protocol-sidebar-content>
        <div id="protocol-metadata-panel" role="tabpanel" aria-labelledby="protocol-metadata-tab" hidden={sidebarTab !== "metadata"}>
          <ProtocolMetadataPanel markdown={content} disabled={!hasDocument || saving} onChange={update} onDirtyChange={setMetadataDirty} />
        </div>
        <div id="protocol-members-panel" role="tabpanel" aria-labelledby="protocol-members-tab" hidden={sidebarTab !== "members"}>
          <ProtocolMembersPanel members={members} action={memberAction} disabled={saving || guestsBusy} onBusyChange={setMembersBusy} onChange={next => {
            setMembers(next);
            if (hasDocument) setContent(current => {
              const updated = withAttendance(current, next);
              return hasManagedAgenda(updated) ? upsertAgenda(updated) : updated;
            });
          }} />
          {attendanceToggle("members")}
        </div>
        <div id="protocol-guests-panel" role="tabpanel" aria-labelledby="protocol-guests-tab" hidden={sidebarTab !== "guests"}>
          <ProtocolGuestsPanel guests={guests} action={guestAction} disabled={saving || membersBusy} onBusyChange={setGuestsBusy} onDirtyChange={setGuestsDirty} onChange={next => {
            setGuests(next);
            if (hasDocument) setContent(current => {
              const updated = withAttendance(current, members, next);
              return hasManagedAgenda(updated) ? upsertAgenda(updated) : updated;
            });
          }} />
          {attendanceToggle("guests")}
        </div>
        {hasLinkedBoard && <div id="protocol-finance-panel" role="tabpanel" aria-labelledby="protocol-finance-tab" hidden={sidebarTab !== "finance"} className="space-y-3">
        <div>
          <h2 className="font-semibold">Finanzanträge</h2>
          <p className="text-xs text-slate-500">TOP-Nummer angeben, dann in den Editor ziehen oder per Button einfügen. Die Einfügemarke zeigt die Zielposition.</p>
        </div>
        {suggestions.length === 0 && <div className="card p-4 text-sm text-slate-500">Keine zugänglichen Vorschläge.</div>}
        {orderedSuggestions.map((card) => {
          const linked = linkedIds.has(card.id);
          return (
            <div
              key={card.id}
              draggable={!linked && !preview && hasDocument}
              onDragStart={(event) => {
                if (!hasDocument || linked || preview || !(tops[card.id] ?? "").trim()) {
                  event.preventDefault();
                  if (!linked && !preview) setState({ error: "Bitte zuerst eine TOP-Nummer für den Finanzantrag angeben." });
                  return;
                }
                draggedCard.current = card.id;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-gremio-card", String(card.id));
              }}
              onDragEnd={() => { draggedCard.current = null; clearDropCaret(); }}
              className="card space-y-2 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{card.number || `Karte ${card.id}`}{card.priority ? ` · ${card.priority}` : ""}</div>
                  <Link href={`/intern/card/${card.id}`} draggable={false} className="font-medium text-brand-600 hover:underline">{card.title}</Link>
                </div>
                {linked && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">im Protokoll</span>}
              </div>
              <p className="text-xs text-slate-600">{card.applicant} · {card.amount == null ? "Betrag —" : (card.amount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</p>
              {card.assignedSession && <p className="text-xs text-slate-500">Zugeordnet: {card.assignedSession}</p>}
              {!linked ? (
                <div className="flex gap-2">
                  <input aria-label={`TOP für ${card.title}`} className="input py-1 text-sm" placeholder="TOP, z. B. 5.1" value={tops[card.id] ?? ""} onChange={(e) => setTops((all) => ({ ...all, [card.id]: e.target.value }))} />
                  <button type="button" disabled={!hasDocument} className="btn-secondary btn-sm" onClick={() => insertCard(card)}>Einfügen</button>
                </div>
              ) : (
                <button type="button" className="btn-secondary btn-sm" onClick={() => removeCard(card.id)}>Verknüpfung entfernen</button>
              )}
            </div>
          );
        })}
        </div>}
        </div>
        </div>
      </aside>
    </div>
  );
}
