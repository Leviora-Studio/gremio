// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { getMarkdownHeadings } from "@/lib/protocol-markdown";
import { markdownLineAt, markdownLineStart, remapMarkdownOffset, replaceMarkdownRange } from "@/lib/protocol-live-editor";
import { escapeTableInput, inlineTokenMarkdown, parseRichLine, richInlineHtml, tableCellRanges, type InlineToken } from "@/lib/markdown-rich-editor";
import { protocolFrontmatterRange } from "@/lib/protocol-frontmatter";
import { indentMarkdown } from "@/lib/markdown-formatting";
import { resizedMarkdownImage } from "@/lib/markdown-images";
import { MarkdownImageResize } from "./MarkdownImageResize";
import { protocolPreviewClassName } from "@/components/protocols/ProtocolMarkdownPreview";

type Selection = { start: number; end: number };
type EditKey = { nativeEvent: { isComposing: boolean }; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string; currentTarget: HTMLElement; preventDefault: () => void };
export type MarkdownLiveEditorHandle = { selection: () => Selection; focusRange: (start: number, end: number) => void; clearDrop: () => void };

// React owns the block, but never reconciles children mutated by contentEditable.
function RichEditable({ source, plain, imageUrl, beforeInput, ...props }: HTMLAttributes<HTMLDivElement> & { source: string; plain?: boolean; imageUrl?: (reference: string) => string | null; beforeInput: (event: InputEvent) => void; "data-rich-start": number; "data-rich-end": number; "data-rich-cell"?: boolean }) {
  const node = useRef<HTMLDivElement>(null);
  const html = richInlineHtml(source, plain, false, imageUrl);
  useLayoutEffect(() => { if (node.current && node.current.innerHTML !== html) node.current.innerHTML = html; });
  useLayoutEffect(() => {
    const element = node.current;
    const handler = (event: Event) => beforeInput(event as InputEvent);
    element?.addEventListener("beforeinput", handler);
    return () => element?.removeEventListener("beforeinput", handler);
  });
  return <div {...props} ref={node} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="false" />;
}

function wrappers(node: HTMLElement): [string, string] {
  const type = node.dataset.mdToken;
  if (type === "escape") return ["\\", ""];
  return type === "strong" ? ["**", "**"] : type === "em" ? ["*", "*"] : type === "underline" ? ["<u>", "</u>"] : type === "code" ? ["`", "`"] : type === "link" ? ["[", `](${node.dataset.mdHref ?? ""})`] : ["", ""];
}
function childrenMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement) || node.tagName === "BR") return "";
  if (node.dataset.mdToken === "image") return node.dataset.mdSource ?? "";
  const content = [...node.childNodes].map(childrenMarkdown).join("");
  const type = node.dataset.mdToken as InlineToken["type"] | undefined;
  if ((type === "strong" || type === "em") && content !== content.trim()) {
    if (!content.trim()) return content;
    return content.match(/^\s*/)?.[0] + inlineTokenMarkdown(type, content.trim()) + content.match(/\s*$/)?.[0];
  }
  return type && content ? inlineTokenMarkdown(type, content, node.dataset.mdHref) : content;
}
function editableFor(node: Node | null) {
  return (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-rich-start]") ?? null;
}
function boundaryOffset(root: HTMLElement, target: Node, offset: number): number {
  let value = 0; let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      value += node === target ? Math.min(offset, node.textContent?.length ?? 0) : node.textContent?.length ?? 0;
      if (node === target) found = true;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.mdToken === "image") { value += node.dataset.mdSource?.length ?? 0; return; }
    const [opening, closing] = node === root ? ["", ""] : wrappers(node);
    value += opening.length;
    if (node === target) {
      for (let index = 0; index < Math.min(offset, node.childNodes.length); index++) value += childrenMarkdown(node.childNodes[index]).length;
      found = true; return;
    }
    for (const child of node.childNodes) visit(child);
    if (!found) value += closing.length;
  };
  visit(root); return value;
}
function pointForOffset(root: HTMLElement, requested: number): { node: Node; offset: number } {
  let position = 0;
  type Point = { node: Node; offset: number };
  const visit = (parent: HTMLElement): Point | undefined => {
    for (let index = 0; index < parent.childNodes.length; index++) {
      const node = parent.childNodes[index];
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0;
        if (requested <= position + length) return { node, offset: Math.max(0, requested - position) };
        position += length;
      } else if (node instanceof HTMLElement) {
        if (node.dataset.mdToken === "image") {
          const length = node.dataset.mdSource?.length ?? 0;
          if (requested <= position + length) return { node: parent, offset: index + (requested > position ? 1 : 0) };
          position += length;
          continue;
        }
        const [opening, closing] = wrappers(node);
        if (requested <= position && opening) return { node: parent, offset: index };
        position += opening.length;
        const found = visit(node); if (found) return found;
        position += closing.length;
        if (requested <= position) return { node: parent, offset: index + 1 };
      }
    }
    return undefined;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
}

// Read-only preview uses this same block tree, so switching modes cannot alter layout.
export const MarkdownLiveEditor = forwardRef<MarkdownLiveEditorHandle, { markdown: string; readOnly?: boolean; imageUrl?: (reference: string) => string | null; onChange: (markdown: string) => void; onCommit: () => void; onCardDrop?: (offset: number) => void }>(function MarkdownLiveEditor({ markdown, readOnly = false, imageUrl, onChange, onCommit, onCardDrop }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<Selection>({ start: markdown.length, end: markdown.length });
  const pending = useRef<Selection | null>(null);
  const last = useRef(markdown);
  const composing = useRef(false);
  const dropOffset = useRef<number | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const [drop, setDrop] = useState<{ top: number; left: number; height: number }>();
  const lines = markdown.split("\n");
  const header = protocolFrontmatterRange(markdown);
  const headerLines = header?.closed ? markdown.slice(0, header.bodyStart).split("\n").length - (markdown[header.bodyStart - 1] === "\n" ? 1 : 0) : 0;

  function currentSelection() {
    const browser = window.getSelection();
    if (!browser?.anchorNode || !browser.focusNode) return selection.current;
    const anchorRoot = editableFor(browser.anchorNode); const focusRoot = editableFor(browser.focusNode);
    if (!anchorRoot || !focusRoot || !root.current?.contains(anchorRoot) || !root.current.contains(focusRoot)) return selection.current;
    const anchor = Number(anchorRoot.dataset.richStart) + boundaryOffset(anchorRoot, browser.anchorNode, browser.anchorOffset);
    const focus = Number(focusRoot.dataset.richStart) + boundaryOffset(focusRoot, browser.focusNode, browser.focusOffset);
    selection.current = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }; return selection.current;
  }
  function focusRange(start: number, end: number) {
    selection.current = { start, end }; pending.current = { start, end }; setFocusRevision(value => value + 1);
  }
  function clearDrop() { dropOffset.current = null; setDrop(undefined); }
  useImperativeHandle(ref, () => ({ selection: currentSelection, focusRange, clearDrop }));
  useLayoutEffect(() => {
    if (last.current !== markdown) {
      if (!pending.current) selection.current = { start: remapMarkdownOffset(last.current, markdown, selection.current.start), end: remapMarkdownOffset(last.current, markdown, selection.current.end) };
      last.current = markdown;
    }
    if (readOnly) { pending.current = null; return; }
    if (!pending.current || !root.current || composing.current) return;
    const wanted = pending.current;
    const editables = [...root.current.querySelectorAll<HTMLElement>("[data-rich-start]")];
    const at = (offset: number) => editables.find(node => offset >= Number(node.dataset.richStart) && offset <= Number(node.dataset.richEnd)) ?? editables.find(node => Number(node.dataset.richStart) > offset) ?? editables.at(-1);
    const startRoot = at(wanted.start); const endRoot = at(wanted.end);
    if (!startRoot || !endRoot) return;
    startRoot.focus({ preventScroll: true });
    const from = pointForOffset(startRoot, wanted.start - Number(startRoot.dataset.richStart));
    const to = pointForOffset(endRoot, wanted.end - Number(endRoot.dataset.richStart));
    const range = document.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
    const browser = window.getSelection(); browser?.removeAllRanges(); browser?.addRange(range);
    pending.current = null;
  }, [markdown, focusRevision, readOnly]);

  function replace(start: number, end: number, text: string, caret?: number) {
    const next = replaceMarkdownRange(markdown, start, end, text);
    const offset = caret ?? next.offset;
    focusRange(offset, offset); last.current = next.markdown; onChange(next.markdown);
  }
  function updateEditable(node: HTMLElement, sourceStart: number, sourceEnd: number) {
    const source = [...node.childNodes].map(childrenMarkdown).join("");
    const current = window.getSelection();
    const caret = current?.anchorNode && node.contains(current.anchorNode) ? boundaryOffset(node, current.anchorNode, current.anchorOffset) : source.length;
    // Native input is needed for IME; ordinary text input uses source transactions below.
    const cell = node.dataset.richCell === "true";
    const escaped = (text: string) => cell ? text.replace(/(?<!\\)\|/g, "\\|").replace(/\n/g, " ") : text;
    replace(sourceStart, sourceEnd, escaped(source), sourceStart + escaped(source.slice(0, caret)).length);
  }
  function moveTo(node: HTMLElement, direction: number, cellsOnly = false) {
    const scope = cellsOnly ? node.closest("table") : root.current;
    const nodes = [...(scope?.querySelectorAll<HTMLElement>(cellsOnly ? '[data-rich-cell="true"]' : "[data-rich-start]") ?? [])];
    const next = nodes[nodes.indexOf(node) + direction];
    if (!next) return false;
    const offset = Number(direction < 0 ? next.dataset.richEnd : next.dataset.richStart);
    focusRange(offset, offset); next.scrollIntoView({ block: "nearest" }); return true;
  }
  function key(event: EditKey, sourceStart: number, sourceEnd: number, blockStart: number, cell: boolean) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const node = event.currentTarget; const selected = currentSelection(); const collapsed = selected.start === selected.end;
    if (cell && ["Tab", "Enter"].includes(event.key)) {
      const direction = event.shiftKey ? -1 : 1;
      if (moveTo(node, direction, true)) event.preventDefault();
      else if (direction > 0) {
        event.preventDefault();
        if (event.key === "Enter" && moveTo(node, 1)) return;
        const row = markdownLineAt(markdown, sourceEnd);
        const tableEnd = Number(node.closest("table")?.dataset.richTableEnd ?? row.end);
        if (event.key === "Tab") {
          const rowText = `\n| ${tableCellRanges(lines[row.index]).map(() => "").join(" | ")} |`;
          replace(tableEnd, tableEnd, rowText, tableEnd + 3);
        } else replace(tableEnd, tableEnd, "\n\n");
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const next = indentMarkdown(markdown, selected, event.shiftKey);
      if (next.markdown !== markdown) {
        focusRange(next.selection.start, next.selection.end);
        last.current = next.markdown;
        onChange(next.markdown);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const sourceLine = lines[markdownLineAt(markdown, sourceStart).index];
      const line = sourceStart === blockStart ? { prefix: "", content: sourceLine, kind: "plain" } : parseRichLine(sourceLine);
      if (!line.content && line.prefix) { replace(blockStart, sourceEnd, ""); return; }
      const continuation = line.kind === "bullet" || line.kind === "quote" ? line.prefix : line.kind === "ordered" ? line.prefix.replace(/\d+/, value => String(Number(value) + 1)) : "";
      const browser = window.getSelection();
      const range = browser?.rangeCount ? browser.getRangeAt(0) : null;
      if (range && node.contains(range.startContainer) && node.contains(range.endContainer)) {
        // Cloning the two DOM fragments closes/reopens inline marks at the split.
        const before = document.createRange(); before.selectNodeContents(node); before.setEnd(range.startContainer, range.startOffset);
        const after = document.createRange(); after.selectNodeContents(node); after.setStart(range.endContainer, range.endOffset);
        const left = [...before.cloneContents().childNodes].map(childrenMarkdown).join("");
        const right = [...after.cloneContents().childNodes].map(childrenMarkdown).join("");
        replace(sourceStart, sourceEnd, `${left}\n${continuation}${right}`, sourceStart + left.length + 1 + continuation.length);
      } else replace(selected.start, selected.end, `\n${continuation}`);
      return;
    }
    if (event.key === "Backspace" && collapsed && selected.start <= sourceStart) {
      event.preventDefault();
      if (cell) { moveTo(node, -1, true); return; }
      if (sourceStart > blockStart) replace(blockStart, sourceStart, "");
      else if (blockStart > 0 && markdown[blockStart - 1] === "\n") {
        const previous = node.parentElement?.previousElementSibling;
        const previousSource = lines[markdownLineAt(markdown, blockStart).index - 1];
        if (blockStart <= (header?.bodyStart ?? 0) || /<!--|-->|^\s*(```|~~~)/.test(previousSource) || previous?.querySelector("table")) moveTo(node, -1);
        else replace(blockStart - 1, blockStart, "");
      }
      return;
    }
    if (event.key === "Delete" && collapsed && selected.end >= sourceEnd) {
      event.preventDefault();
      if (cell) { moveTo(node, 1, true); return; }
      const nextLine = markdownLineAt(markdown, sourceEnd).index + 1;
      const next = lines[nextLine];
      if (next !== undefined && !next.trim().startsWith("|") && !/^\s*(```|~~~|<!--)/.test(next)) replace(sourceEnd, sourceEnd + 1 + parseRichLine(next).prefix.length, "");
      else moveTo(node, 1);
      return;
    }
    if (collapsed && ((event.key === "ArrowLeft" && selected.start <= sourceStart) || (event.key === "ArrowRight" && selected.end >= sourceEnd))) {
      if (moveTo(node, event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
    }
    if (collapsed && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      const browser = window.getSelection(); const rect = browser?.rangeCount ? browser.getRangeAt(0).getClientRects()[0] : null;
      const bounds = node.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 24;
      if (!rect || (event.key === "ArrowUp" ? rect.top < bounds.top + lineHeight : rect.bottom > bounds.bottom - lineHeight)) {
        if (cell) {
          const rows = [...(node.closest("table")?.querySelectorAll("tr") ?? [])];
          const row = node.closest("tr")!;
          const column = [...row.querySelectorAll("[data-rich-cell]")].indexOf(node);
          const next = rows[rows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)]?.querySelectorAll<HTMLElement>("[data-rich-cell]")[column];
          if (next) { event.preventDefault(); focusRange(Number(next.dataset.richStart), Number(next.dataset.richStart)); next.scrollIntoView({ block: "nearest" }); }
          return;
        }
        if (moveTo(node, event.key === "ArrowUp" ? -1 : 1)) event.preventDefault();
      }
    }
  }
  function paste(event: React.ClipboardEvent<HTMLElement>, cell: boolean) {
    event.preventDefault(); const selected = currentSelection(); const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    replace(selected.start, selected.end, cell ? escapeTableInput(text) : text);
  }
  function editable(content: string, contentStart: number, sourceEnd: number, blockStart: number, className: string, keyValue: string, cell = false, plain = false) {
    const textClassName = `${className} min-h-6 whitespace-pre-wrap break-words rounded-sm outline-none`;
    if (readOnly) return <div key={keyValue} data-markdown-text className={textClassName} dangerouslySetInnerHTML={{ __html: richInlineHtml(content, plain, true, imageUrl) }} />;
    return <RichEditable key={keyValue} source={content} plain={plain} imageUrl={imageUrl} data-markdown-text aria-label={cell ? "Markdown-Tabellenzelle" : "Markdown-Absatz"} data-rich-start={contentStart} data-rich-end={sourceEnd} data-rich-cell={cell} className={`${textClassName} cursor-text focus:bg-brand-50/40`} onMouseUp={currentSelection} onKeyUp={currentSelection} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; updateEditable(event.currentTarget, contentStart, sourceEnd); }} onInput={event => { if (!composing.current) updateEditable(event.currentTarget, contentStart, sourceEnd); }} onKeyDown={event => key(event, contentStart, sourceEnd, blockStart, cell)} onPaste={event => paste(event, cell)} onCut={event => {
      const selected = currentSelection(); if (selected.start === selected.end) return;
      event.preventDefault(); event.clipboardData.setData("text/plain", window.getSelection()?.toString() ?? ""); replace(selected.start, selected.end, "");
    }} beforeInput={event => {
      // Preserve the exact source selection, including positions outside hidden inline markers.
      if (composing.current || event.isComposing || !event.cancelable) return;
      const inputKey = event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" ? "Enter" : event.inputType === "deleteContentBackward" ? "Backspace" : event.inputType === "deleteContentForward" ? "Delete" : null;
      if (inputKey) {
        key({ nativeEvent: event, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, currentTarget: event.currentTarget as HTMLElement, key: inputKey, preventDefault: () => event.preventDefault() }, contentStart, sourceEnd, blockStart, cell); return;
      }
      if (event.inputType !== "insertText" || event.data === null) return;
      event.preventDefault(); const selected = currentSelection(); replace(selected.start, selected.end, cell ? escapeTableInput(event.data) : event.data);
    }} />;
  }

  const output: ReactNode[] = []; const consumed = new Set<number>();
  const headings = new Map(getMarkdownHeadings(markdown).map(item => [item.line, item]));
  let fence: { char: string; length: number } | null = null;
  let comment = false;
  for (let index = headerLines; index < lines.length; index++) {
    if (consumed.has(index)) continue;
    const line = lines[index]; const lineStart = markdownLineStart(markdown, index); const lineEnd = lineStart + line.length;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch && (!fence || fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length)) {
      fence = fence ? null : { char: fenceMatch[1][0], length: fenceMatch[1].length };
      output.push(<div key={index} data-markdown-line={index} className="text-xs text-slate-400">{editable(line, lineStart, lineEnd, lineStart, "font-mono", `line-${index}`, false, true)}</div>); continue;
    }
    if (!fence && line.trim().startsWith("<!--")) comment = true;
    if (comment) { if (line.includes("-->")) comment = false; continue; }
    if (!fence && line.trim().startsWith("|") && /^\|[\s:|-]+\|\s*$/.test(lines[index + 1]?.trim() ?? "")) {
      const rows: number[] = [index]; consumed.add(index + 1);
      for (let next = index + 2; next < lines.length && lines[next].trim().startsWith("|"); next++) { rows.push(next); consumed.add(next); }
      const cells = (row: number, header: boolean) => {
        const start = markdownLineStart(markdown, row); const Tag = header ? "th" : "td";
        return tableCellRanges(lines[row]).map((range, column) => <Tag key={column} className={`min-w-24 border border-slate-200 p-2 align-top focus-within:bg-brand-50/60 ${header ? "bg-slate-50 font-semibold" : ""}`}>{editable(range.content, start + range.start, start + range.end, start, "", `cell-${row}-${column}`, true)}</Tag>);
      };
      const lastRow = Math.max(index + 1, rows.at(-1)!);
      output.push(<div key={`table-${index}`} data-markdown-line={index} className="overflow-x-auto rounded border border-slate-200"><table data-rich-table-end={markdownLineStart(markdown, lastRow) + lines[lastRow].length} className="w-full border-collapse text-left text-sm"><thead><tr>{cells(index, true)}</tr></thead><tbody>{rows.slice(1).map(row => <tr key={row} data-markdown-line={row}>{cells(row, false)}</tr>)}</tbody></table></div>); continue;
    }
    const rich = fence ? { prefix: "", content: line, kind: "plain" as const, level: 0, marker: undefined } : parseRichLine(line);
    const style = fence ? "bg-slate-50 font-mono text-sm" : rich.kind === "heading" ? rich.level === 1 ? "text-2xl font-bold" : rich.level === 2 ? "text-xl font-semibold" : "text-lg font-semibold" : rich.kind === "quote" ? "border-l-2 border-slate-300 pl-3 text-slate-600" : "text-sm leading-6";
    const heading = headings.get(index);
    const listIndent = rich.kind === "bullet" || rich.kind === "ordered" ? (rich.prefix.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "    ").length : 0;
    output.push(<div key={index} data-markdown-line={index} id={heading?.slug} style={listIndent ? { paddingLeft: `${listIndent * 0.375}rem` } : undefined} className={`flex min-h-6 items-start ${rich.kind === "bullet" ? "gap-1.5" : "gap-2"}`}>
      {rich.kind === "bullet" ? <span aria-hidden="true" className="flex h-6 w-[5px] shrink-0 items-center"><span data-markdown-bullet className="h-[5px] w-[5px] rounded-full bg-slate-600" /></span> : rich.marker && <span aria-hidden="true" className="select-none pt-0.5 text-sm text-slate-500">{rich.marker}</span>}
      {editable(rich.content, lineStart + rich.prefix.length, lineEnd, lineStart, `min-w-0 flex-1 ${style}`, `line-${index}`, false, !!fence)}
    </div>);
  }
  return <div ref={root} data-markdown-renderer role="group" aria-label={readOnly ? "Dokumentvorschau" : "Live-Editor"} className={`${protocolPreviewClassName} relative`} onBlur={event => { if (!readOnly && !event.currentTarget.contains(event.relatedTarget as Node | null)) { currentSelection(); onCommit(); } }} onDragOver={event => {
    if (readOnly || !onCardDrop || !event.dataTransfer.types.includes("application/x-gremio-card")) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "copy";
    const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const legacy = !position ? (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range }).caretRangeFromPoint?.(event.clientX, event.clientY) : null;
    const node = position?.offsetNode ?? legacy?.startContainer; const offset = position?.offset ?? legacy?.startOffset;
    const target = editableFor(node ?? null);
    if (!node || offset === undefined || !target || !root.current?.contains(target)) { clearDrop(); return; }
    dropOffset.current = Number(target.dataset.richStart) + boundaryOffset(target, node, offset);
    const range = document.createRange(); range.setStart(node, offset); range.collapse();
    const rect = range.getClientRects()[0] ?? target.getBoundingClientRect(); const bounds = root.current.getBoundingClientRect();
    setDrop({ top: rect.top - bounds.top, left: rect.left - bounds.left, height: Math.max(2, rect.height) });
  }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDrop(); }} onDrop={event => {
    // Reject browser HTML/file drops; finance blocks are inserted by the parent only.
    event.preventDefault(); if (!readOnly && onCardDrop && event.dataTransfer.types.includes("application/x-gremio-card") && dropOffset.current !== null) onCardDrop(dropOffset.current); clearDrop();
  }}>
    {output}
    {!readOnly && <MarkdownImageResize root={root} locate={image => {
      const editable = editableFor(image); const parent = image.parentElement;
      if (!editable || !parent || !image.dataset.mdSource) return null;
      const start = Number(editable.dataset.richStart) + boundaryOffset(editable, parent, [...parent.childNodes].indexOf(image));
      return { image, start, end: start + image.dataset.mdSource.length, source: image.dataset.mdSource };
    }} onResize={(target, width) => { if (markdown.slice(target.start, target.end) === target.source) replace(target.start, target.end, resizedMarkdownImage(target.source, width)); }} />}
    {!readOnly && drop && <span aria-hidden="true" className="pointer-events-none absolute w-0.5 bg-brand-600" style={drop} />}
  </div>;
});
