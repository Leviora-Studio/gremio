// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { markdownLineAt, markdownLineStart, replaceMarkdownRange } from "@/lib/protocol-live-editor";
import { textareaDropCaret } from "@/lib/textarea-drop-caret";
import { ProtocolMarkdownPreview, protocolPreviewClassName } from "./ProtocolMarkdownPreview";

export type ProtocolLiveEditorHandle = {
  selection: () => { start: number; end: number };
  focusAt: (offset: number) => void;
  clearDrop: () => void;
};
type Snapshot = { markdown: string; offset: number };

export const ProtocolLiveEditor = forwardRef<ProtocolLiveEditorHandle, {
  markdown: string;
  onChange: (markdown: string) => void;
  onCommit: () => void;
  onCardDrop: (offset: number) => void;
}> (function ProtocolLiveEditor({ markdown, onChange, onCommit, onCardDrop }, ref) {
  const [activeLine, setActiveLine] = useState<number>();
  const [drop, setDrop] = useState<{ offset: number; top: number; left: number; height: number; inline: boolean }>();
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef({ start: markdown.length, end: markdown.length });
  const pendingFocus = useRef<number | null>(null);
  const composing = useRef(false);
  const lastMarkdown = useRef(markdown);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const lines = markdown.split("\n");
  const line = activeLine === undefined ? undefined : Math.min(activeLine, lines.length - 1);
  const start = line === undefined ? markdown.length : markdownLineStart(markdown, line);

  function focusAt(offset: number) {
    const bounded = Math.max(0, Math.min(offset, markdown.length));
    pendingFocus.current = bounded;
    selection.current = { start: bounded, end: bounded };
    setActiveLine(markdownLineAt(markdown, bounded).index);
    // Also handle clicks within an already active line without a state change.
    if (input.current && line === markdownLineAt(markdown, bounded).index) {
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(bounded - start, bounded - start);
      pendingFocus.current = null;
    }
  }

  function currentSelection() {
    const node = input.current;
    if (node) selection.current = { start: start + node.selectionStart, end: start + node.selectionEnd };
    return selection.current;
  }

  useImperativeHandle(ref, () => ({ selection: currentSelection, focusAt, clearDrop: () => setDrop(undefined) }));

  useLayoutEffect(() => {
    if (lastMarkdown.current !== markdown) {
      // External changes (attendance, reload, insertion) establish a new undo baseline.
      undo.current = [];
      redo.current = [];
      lastMarkdown.current = markdown;
    }
    const node = input.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
    if (pendingFocus.current !== null && !composing.current) {
      const column = Math.max(0, pendingFocus.current - start);
      node.focus({ preventScroll: true });
      node.setSelectionRange(column, column);
      pendingFocus.current = null;
    }
  });

  function apply(next: string, offset: number, remember = true) {
    if (remember) {
      undo.current.push({ markdown, offset: selection.current.start });
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    }
    lastMarkdown.current = next;
    selection.current = { start: offset, end: offset };
    pendingFocus.current = offset;
    setActiveLine(markdownLineAt(next, offset).index);
    onChange(next);
  }

  const editor = <textarea
    ref={input}
    aria-label="Aktuelle Markdown-Zeile"
    className="block w-full resize-none overflow-hidden rounded bg-slate-50 px-1 font-mono text-sm font-normal leading-6 text-slate-900 outline-none"
    rows={1}
    value={line === undefined ? "" : lines[line]}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; pendingFocus.current = null; }}
    onSelect={event => { selection.current = { start: start + event.currentTarget.selectionStart, end: start + event.currentTarget.selectionEnd }; }}
    onChange={event => {
      const node = event.currentTarget;
      const next = replaceMarkdownRange(markdown, start, start + (lines[line ?? 0]?.length ?? 0), node.value);
      apply(next.markdown, start + node.selectionStart);
    }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const node = event.currentTarget;
      const from = node.selectionStart;
      const to = node.selectionEnd;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        const backwards = event.key.toLowerCase() === "z" && !event.shiftKey;
        const source = backwards ? undo.current : redo.current;
        const target = backwards ? redo.current : undo.current;
        const snapshot = source.pop();
        if (snapshot) { target.push({ markdown, offset: start + from }); apply(snapshot.markdown, snapshot.offset, false); }
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); setActiveLine(undefined); root.current?.focus({ preventScroll: true }); onCommit(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || from !== to) return;
      if (event.key === "Backspace" && from === 0 && start > 0) {
        event.preventDefault(); const next = replaceMarkdownRange(markdown, start - 1, start, ""); apply(next.markdown, next.offset); return;
      }
      if (event.key === "Delete" && from === node.value.length && start + from < markdown.length) {
        event.preventDefault(); const next = replaceMarkdownRange(markdown, start + from, start + from + 1, ""); apply(next.markdown, next.offset); return;
      }
      if (event.key === "ArrowLeft" && from === 0 && start > 0) { event.preventDefault(); focusAt(start - 1); return; }
      if (event.key === "ArrowRight" && from === node.value.length && start + from < markdown.length) { event.preventDefault(); focusAt(start + from + 1); return; }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const bounds = node.getBoundingClientRect();
        const firstRowEnd = textareaDropCaret(node, bounds.right - 2, bounds.top + 12)?.offset ?? node.value.length;
        const lastRowStart = textareaDropCaret(node, bounds.left + 2, bounds.bottom - 12)?.offset ?? 0;
        const previous = event.key === "ArrowUp";
        if (previous ? from > firstRowEnd : from < lastRowStart) return;
        const nextLine = (line ?? 0) + (previous ? -1 : 1);
        if (nextLine >= 0 && nextLine < lines.length) {
          event.preventDefault(); focusAt(markdownLineStart(markdown, nextLine) + Math.min(from, lines[nextLine].length));
        }
      }
    }}
  />;

  return <div
    ref={root}
    tabIndex={0}
    role="group"
    aria-label="Live-Vorschau des Protokolls"
    className={`${protocolPreviewClassName} relative cursor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) { currentSelection(); setActiveLine(undefined); onCommit(); }
    }}
    onKeyDown={event => {
      if (event.target === event.currentTarget && ["Enter", "ArrowDown"].includes(event.key)) { event.preventDefault(); focusAt(0); }
    }}
    onClick={event => {
      const target = event.target as HTMLElement;
      if (target.closest("textarea, a")) return;
      const source = target.closest<HTMLElement>("[data-markdown-line]");
      const index = source ? Number(source.dataset.markdownLine) : lines.length - 1;
      focusAt(markdownLineStart(markdown, index));
    }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes("application/x-gremio-card")) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      const target = event.target as HTMLElement;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (target instanceof HTMLTextAreaElement) {
        const caret = textareaDropCaret(target, event.clientX, event.clientY);
        if (caret) {
          const inputBounds = target.getBoundingClientRect();
          setDrop({ offset: start + caret.offset, top: inputBounds.top - bounds.top + caret.top, left: inputBounds.left - bounds.left + caret.left, height: caret.height, inline: true });
          return;
        }
      }
      const source = target.closest<HTMLElement>("[data-markdown-line]");
      const rect = source?.getBoundingClientRect();
      const after = !!rect && event.clientY > rect.top + rect.height / 2;
      const index = source ? Number(source.dataset.markdownLine) : lines.length - 1;
      const offset = markdownLineStart(markdown, index) + (after || !source ? lines[index].length : 0);
      setDrop({ offset, top: rect ? (after ? rect.bottom : rect.top) - bounds.top : bounds.height - 20, left: 20, height: 2, inline: false });
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(undefined); }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes("application/x-gremio-card")) return;
      event.preventDefault();
      if (drop) onCardDrop(drop.offset);
      setDrop(undefined);
    }}
  >
    <ProtocolMarkdownPreview markdown={markdown} activeLine={line} editor={editor} />
    {drop && <span data-protocol-drop-caret aria-hidden="true" className="pointer-events-none absolute bg-brand-600" style={{ top: drop.top, left: drop.left, height: drop.height, width: drop.inline ? 2 : "calc(100% - 40px)" }} />}
  </div>;
});
