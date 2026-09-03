// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ProtocolState } from "@/app/intern/protokolle/actions";
import {
  extractFinanceLinks,
  formatFinanceBlock,
  markdownHeadingSlug,
  upsertToc,
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
  initialEtag,
  suggestions,
  cardBaseUrl,
  saveAction,
  reloadAction,
}: {
  initialContent: string;
  initialEtag: string;
  suggestions: Suggestion[];
  cardBaseUrl: string;
  saveAction: (content: string, etag: string) => Promise<ProtocolState>;
  reloadAction: () => Promise<{ content?: string; etag?: string; error?: string }>;
}) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [etag, setEtag] = useState(initialEtag);
  const [state, setState] = useState<ProtocolState>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tops, setTops] = useState<Record<number, string>>({});
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dirty = content !== savedContent;
  const linkedIds = useMemo(() => new Set(extractFinanceLinks(content).map((link) => link.cardId)), [content]);

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
    setContent(next.includes("<!-- gremio:toc:start -->") ? upsertToc(next) : next);
    setState({});
  }

  function insertCard(card: Suggestion) {
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
    const node = textarea.current;
    if (!node) return update(`${content.trimEnd()}\n\n${block}\n`);
    const start = node.selectionStart;
    const end = node.selectionEnd;
    update(`${content.slice(0, start)}${start ? "\n\n" : ""}${block}\n${content.slice(end)}`);
    requestAnimationFrame(() => node.focus());
  }

  function removeCard(cardId: number) {
    const exact = new RegExp(`\\n?<!-- gremio:finance:start card=${cardId} -->[\\s\\S]*?<!-- gremio:finance:end card=${cardId} -->\\n?`, "g");
    const next = content.replace(exact, "\n");
    if (next === content) {
      setState({ error: "Der verwaltete Block wurde manuell verändert. Entferne den gesamten Finanzantragsblock beziehungsweise den Link zur Gremio-Karte direkt im Editor und speichere erneut." });
      return;
    }
    update(next);
  }

  async function save() {
    setSaving(true);
    const result = await saveAction(content, etag);
    setSaving(false);
    setState(result);
    if (result.etag) setEtag(result.etag);
    if (result.savedToNextcloud) setSavedContent(content);
  }

  async function reload() {
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen und Nextcloud neu laden?")) return;
    const result = await reloadAction();
    if (result.error) return setState({ error: result.error });
    setContent(result.content ?? "");
    setSavedContent(result.content ?? "");
    setEtag(result.etag ?? "");
    setState({ success: "Aktueller Nextcloud-Stand geladen." });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="card min-w-0 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPreview(false)}>Bearbeiten</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPreview(true)}>Vorschau</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => update(upsertToc(content))}>Inhaltsverzeichnis aktualisieren</button>
          <span className={`ml-auto text-sm ${state.conflict ? "text-red-700" : dirty ? "text-amber-700" : "text-green-700"}`}>
            {state.conflict ? "Konflikt" : dirty ? "Ungespeichert" : "Gespeichert"}
          </span>
        </div>
        {preview ? (
          <MarkdownPreview markdown={content} />
        ) : (
          <textarea
            ref={textarea}
            aria-label="Markdown-Protokoll"
            className="input min-h-[38rem] resize-y font-mono text-sm leading-6"
            value={content}
            onChange={(event) => update(event.target.value)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = Number(event.dataTransfer.getData("application/x-gremio-card"));
              const card = suggestions.find((item) => item.id === id);
              if (card) insertCard(card);
            }}
          />
        )}
        {(state.error || state.success) && (
          <div className={`mt-3 rounded-md p-3 text-sm ${state.error ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
            {state.error ?? state.success}
            {state.conflict && <button type="button" className="ml-2 underline" onClick={reload}>Nextcloud-Stand neu laden</button>}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={saving || !dirty} className="btn-primary" onClick={save}>{saving ? "Speichert…" : "In Nextcloud speichern"}</button>
          <button type="button" className="btn-secondary" onClick={reload}>Neu laden</button>
        </div>
      </section>

      <aside className="space-y-3">
        <div>
          <h2 className="font-semibold">Finanzanträge</h2>
          <p className="text-xs text-slate-500">Aus der konfigurierten Quellspalte. Ziehen oder barrierearm per Button einfügen.</p>
        </div>
        {suggestions.length === 0 && <div className="card p-4 text-sm text-slate-500">Keine zugänglichen Vorschläge.</div>}
        {suggestions.map((card) => {
          const linked = linkedIds.has(card.id);
          return (
            <div
              key={card.id}
              draggable={!linked}
              onDragStart={(event) => event.dataTransfer.setData("application/x-gremio-card", String(card.id))}
              className={`card space-y-2 p-3 ${card.assignedSession ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">{card.number || `Karte ${card.id}`}{card.priority ? ` · ${card.priority}` : ""}</div>
                  <Link href={`/intern/card/${card.id}`} className="font-medium text-brand-600 hover:underline">{card.title}</Link>
                </div>
                {linked && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">im Protokoll</span>}
              </div>
              <p className="text-xs text-slate-600">{card.applicant} · {card.amount == null ? "Betrag —" : (card.amount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</p>
              {card.assignedSession && <p className="text-xs text-slate-500">Zugeordnet: {card.assignedSession}</p>}
              {!linked ? (
                <div className="flex gap-2">
                  <input aria-label={`TOP für ${card.title}`} className="input py-1 text-sm" placeholder="TOP, z. B. 5.1" value={tops[card.id] ?? ""} onChange={(e) => setTops((all) => ({ ...all, [card.id]: e.target.value }))} />
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insertCard(card)}>Einfügen</button>
                </div>
              ) : (
                <button type="button" className="btn-secondary btn-sm" onClick={() => removeCard(card.id)}>Verknüpfung entfernen</button>
              )}
            </div>
          );
        })}
      </aside>
    </div>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const counts = new Map<string, number>();
  return (
    <div className="min-h-[38rem] space-y-2 break-words rounded-md border border-slate-200 bg-white p-5 text-sm">
      {lines.map((line, index) => {
        if (/^<!--/.test(line)) return null;
        const heading = /^(#{1,6})\s+(.+)/.exec(line);
        if (heading) {
          const level = heading[1].length;
          const base = markdownHeadingSlug(heading[2]);
          const seen = counts.get(base) ?? 0;
          counts.set(base, seen + 1);
          const id = seen ? `${base}-${seen}` : base;
          const className = level === 1 ? "text-2xl font-bold" : level === 2 ? "text-xl font-semibold" : "text-lg font-semibold";
          return <div key={index} id={id} className={className}>{inlineMarkdown(heading[2])}</div>;
        }
        const bullet = /^[-*]\s+(.+)/.exec(line);
        if (bullet) return <div key={index} className="pl-4">• {inlineMarkdown(bullet[1])}</div>;
        if (!line.trim()) return <div key={index} className="h-2" />;
        return <p key={index} className="whitespace-pre-wrap">{inlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

function inlineMarkdown(text: string) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+|#[^)]+)\)/g)) {
    const index = match.index ?? 0;
    parts.push(text.slice(cursor, index));
    parts.push(<a key={index} href={match[2]} className="text-brand-600 underline" target={match[2].startsWith("http") ? "_blank" : undefined} rel="noopener">{match[1]}</a>);
    cursor = index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
