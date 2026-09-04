// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { findDocumentMatches, nextDocumentMatch } from "@/lib/document-search";

type Hit = { start: number; end: number; range?: Range };
type Rect = { top: number; left: number; width: number; height: number };

function textPoint(root: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) return [node, offset];
    offset -= length;
  }
  return [root, root.childNodes.length];
}

export function DocumentSearch({ content, mode, scroller, editor, focusRevision, onClose }: {
  content: string;
  mode: "live" | "edit" | "preview";
  scroller: RefObject<HTMLDivElement | null>;
  editor: RefObject<HTMLTextAreaElement | null>;
  focusRevision: number;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [index, setIndex] = useState(0);
  const [overlay, setOverlay] = useState<{ parent: HTMLElement; rects: Rect[] } | null>(null);
  const active = Math.min(index, Math.max(0, hits.length - 1));
  const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRevision]);
  useEffect(() => {
    if (!supportsHighlights) return;
    // Next 15's Turbopack CSS parser rejects ::highlight. Let the supporting
    // browser parse these static rules directly, outside the CSS build pipeline.
    const style = document.createElement("style");
    style.setAttribute("data-document-search-styles", "");
    style.textContent = `
      ::highlight(document-search) { background-color: #fef08a; color: #0f172a; }
      ::highlight(document-search-active) { background-color: #fbbf24; color: #0f172a; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [supportsHighlights]);
  useEffect(() => {
    const next: Hit[] = [];
    if (query && mode === "edit") next.push(...findDocumentMatches(content, query));
    else if (query) {
      // Search only document text, never the toolbar, sidebar or hidden YAML/markers.
      // A range can cross inline formatting, but never mix neighboring table cells.
      for (const block of scroller.current?.querySelectorAll<HTMLElement>("[data-markdown-text]") ?? []) {
        for (const hit of findDocumentMatches(block.textContent ?? "", query)) {
          const range = document.createRange();
          range.setStart(...textPoint(block, hit.start)); range.setEnd(...textPoint(block, hit.end));
          next.push({ ...hit, range });
        }
      }
    }
    setHits(next);
    setIndex(current => Math.min(current, Math.max(0, next.length - 1)));
  }, [content, mode, query, scroller]);

  useEffect(() => {
    if (!supportsHighlights) return;
    const all = new Highlight(); const current = new Highlight();
    for (const hit of hits) if (hit.range) all.add(hit.range);
    if (hits[active]?.range) current.add(hits[active].range!);
    current.priority = 1;
    CSS.highlights.set("document-search", all);
    CSS.highlights.set("document-search-active", current);
    return () => { CSS.highlights.delete("document-search"); CSS.highlights.delete("document-search-active"); };
  }, [hits, active, supportsHighlights]);

  useEffect(() => {
    const hit = hits[active]; const viewport = scroller.current;
    setOverlay(null);
    if (!hit || !viewport) return;
    let mirror: HTMLDivElement | undefined;
    const measure = (scroll: boolean) => {
      let rects: DOMRect[]; let target: HTMLElement; let base: DOMRect;
      const textarea = editor.current;
      if (mode === "edit" && textarea) {
        if (hit.end > content.length || !content) return;
        // Measure wrapped source text using the textarea's actual typography.
        // The textarea itself remains untouched and the query field keeps focus.
        mirror?.remove(); mirror = document.createElement("div");
        const style = getComputedStyle(textarea);
        Object.assign(mirror.style, {
          position: "fixed", left: "0", top: "0", visibility: "hidden", pointerEvents: "none",
          width: `${textarea.getBoundingClientRect().width}px`, boxSizing: style.boxSizing,
          font: style.font, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
          padding: style.padding, border: style.border, whiteSpace: "pre-wrap", overflowWrap: "break-word", tabSize: style.tabSize,
        });
        mirror.setAttribute("aria-hidden", "true"); mirror.textContent = content;
        document.body.appendChild(mirror);
        const range = document.createRange();
        range.setStart(mirror.firstChild!, hit.start); range.setEnd(mirror.firstChild!, hit.end);
        const origin = mirror.getBoundingClientRect(); const bounds = textarea.getBoundingClientRect();
        rects = [...range.getClientRects()].map(rect => new DOMRect(bounds.left + rect.left - origin.left, bounds.top + rect.top - origin.top, rect.width, rect.height));
        target = textarea.parentElement!; base = target.getBoundingClientRect();
        textarea.setSelectionRange(hit.start, hit.end);
      } else if (hit.range?.startContainer.isConnected) {
        rects = [...hit.range.getClientRects()]; target = viewport; base = viewport.getBoundingClientRect();
        // Make the cell visible even when its table scrolls horizontally.
        const element = hit.range.startContainer.parentElement;
        if (scroll) {
          const tableScroll = element?.closest("table")?.parentElement;
          const first = rects[0];
          if (tableScroll && first) {
            const bounds = tableScroll.getBoundingClientRect();
            if (first.left < bounds.left || first.right > bounds.right) tableScroll.scrollLeft += first.left - bounds.left - bounds.width / 2;
            rects = [...hit.range.getClientRects()];
          }
        }
      } else return;
      const first = rects[0];
      if (mode === "edit" || !supportsHighlights) setOverlay({ parent: target, rects: rects.map(rect => ({
        top: rect.top - base.top + target.scrollTop, left: rect.left - base.left + target.scrollLeft,
        width: Math.max(2, rect.width), height: rect.height,
      })) });
      if (scroll && first) {
        const bounds = viewport.getBoundingClientRect();
        viewport.scrollTop += first.top - bounds.top - bounds.height / 2;
      }
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(viewport);
    const onScroll = () => { if (mode !== "edit" && !supportsHighlights) measure(false); };
    viewport.addEventListener("scroll", onScroll, true);
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", onScroll, true); mirror?.remove(); };
  }, [hits, active, mode, content, scroller, editor, supportsHighlights]);

  const move = (direction: number) => setIndex(nextDocumentMatch(active, hits.length, direction));
  return <>
    <div id="document-search" role="search" aria-label="Dokument durchsuchen" className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 sm:px-5" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Enter" && event.target === input.current) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    }}>
      <input ref={input} type="search" aria-label="Im Dokument suchen" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} placeholder="Im Dokument suchen …" className="input min-w-0 flex-1 basis-40 !h-8 text-sm" />
      <span role="status" aria-live="polite" className="min-w-16 text-center text-xs text-slate-500">{!query ? "Suchbegriff eingeben" : hits.length ? `${active + 1} von ${hits.length}` : "Keine Treffer"}</span>
      <button type="button" aria-label="Vorheriger Treffer" title="Vorheriger Treffer (Umschalt+Enter)" disabled={!hits.length} onClick={() => move(-1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-200 disabled:opacity-40">↑</button>
      <button type="button" aria-label="Nächster Treffer" title="Nächster Treffer (Enter)" disabled={!hits.length} onClick={() => move(1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-200 disabled:opacity-40">↓</button>
      <button type="button" aria-label="Suche schließen" title="Suche schließen (Escape)" onClick={onClose} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-200">×</button>
    </div>
    {overlay && createPortal(<div aria-hidden="true" className="pointer-events-none absolute inset-0" data-document-search-overlay>{overlay.rects.map((rect, i) => <span key={i} className="absolute rounded-sm bg-amber-400/40" style={rect} />)}</div>, overlay.parent)}
  </>;
}
