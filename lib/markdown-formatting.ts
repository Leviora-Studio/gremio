// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type MarkdownSelection = { start: number; end: number };
export type MarkdownCommand = "h1" | "h2" | "h3" | "bullet" | "ordered" | "bold" | "italic" | "underline" | "code" | "quote" | { table: { rows: number; columns: number } };
export type MarkdownEdit = { markdown: string; selection: MarkdownSelection };

/** Indent complete selected lines; four spaces also nest lists in the PDF renderer. */
export function indentMarkdown(source: string, selection: MarkdownSelection, outdent = false): MarkdownEdit {
  const start = Math.max(0, Math.min(selection.start, source.length));
  const end = Math.max(start, Math.min(selection.end, source.length));
  const first = start === 0 ? 0 : source.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && source[end - 1] === "\n" ? end - 1 : end;
  const mapped = { start, end };
  let offset = 0;
  const markdown = source.split("\n").map(line => {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart < first || lineStart > last) return line;
    const removed = outdent ? (line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0) : 0;
    for (const boundary of ["start", "end"] as const) {
      const position = boundary === "start" ? start : end;
      if (position >= lineStart) mapped[boundary] += outdent ? -Math.min(removed, position - lineStart) : 4;
    }
    return outdent ? line.slice(removed) : "    " + line;
  }).join("\n");
  return { markdown, selection: mapped };
}

/** Pure source transformations shared by the raw editor and live preview. */
export function formatMarkdown(source: string, selection: MarkdownSelection, command: MarkdownCommand): MarkdownEdit {
  let start = Math.max(0, Math.min(selection.start, source.length));
  let end = Math.max(start, Math.min(selection.end, source.length));
  const replace = (text: string, from: number, to = from) => ({ markdown: source.slice(0, start) + text + source.slice(end), selection: { start: start + from, end: start + to } });
  if (typeof command === "object") {
    const { rows, columns } = command.table;
    if (!Number.isInteger(rows) || rows < 1 || rows > 10 || !Number.isInteger(columns) || columns < 1 || columns > 8) throw new Error("Ungültige Tabellengröße.");
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const prefix = start && source[start - 1] !== "\n" ? "\n\n" : start ? "\n" : "";
    const table = [line(Array.from({ length: columns }, (_, i) => `Spalte ${i + 1}`)), line(Array(columns).fill("---")), ...Array.from({ length: rows }, () => line(Array(columns).fill(" ")))].join("\n");
    return replace(prefix + table + "\n\n", prefix.length + 2, prefix.length + 10);
  }
  const markers = { bold: ["**", "**"], italic: ["*", "*"], underline: ["<u>", "</u>"], code: ["`", "`"] };
  if (command in markers) {
    const [left, right] = markers[command as keyof typeof markers];
    const selected = source.slice(start, end);
    if (selected.startsWith(left) && selected.endsWith(right) && selected.length >= left.length + right.length) {
      const value = selected.slice(left.length, -right.length);
      return replace(value, 0, value.length);
    }
    if (source.slice(start - left.length, start) === left && source.slice(end, end + right.length) === right) {
      start -= left.length; end += right.length;
      return replace(selected, 0, selected.length);
    }
    const value = selected || "Text";
    return replace(left + value + right, left.length, left.length + value.length);
  }
  const lineStart = start === 0 ? 0 : source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", end > start && source[end - 1] === "\n" ? end - 1 : end);
  const to = lineEnd < 0 ? source.length : lineEnd;
  const lines = source.slice(lineStart, to).split("\n");
  const transformed = lines.map((line, index) => {
    const bare = line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "");
    const prefix = command === "bullet" ? "- " : command === "ordered" ? `${index + 1}. ` : command === "quote" ? "> " : "#".repeat(Number(command.slice(1))) + " ";
    return prefix + bare;
  });
  const oldStart = start;
  const oldEnd = end;
  start = lineStart; end = to;
  const text = transformed.join("\n");
  if (oldStart === oldEnd) {
    const shift = transformed[0].length - lines[0].length;
    return replace(text, Math.max(0, Math.min(text.length, oldStart - lineStart + shift)));
  }
  return replace(text, 0, text.length);
}
