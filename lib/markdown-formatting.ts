// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type MarkdownSelection = { start: number; end: number };
export type MarkdownCommand = "h1" | "h2" | "h3" | "h4" | "h5" | "bullet" | "ordered" | "bold" | "italic" | "underline" | "code" | "quote" | { table: { rows: number; columns: number } };
export type MarkdownEdit = { markdown: string; selection: MarkdownSelection };

const orderedLinePattern = /^([ \t]*)(\d+)[.)]([ \t]+)(.*)$/;

function normalizeOrderedBlocks(lines: string[], selected: Set<number>) {
  const visited = new Set<number>();
  for (const selectedIndex of selected) {
    if (visited.has(selectedIndex) || !orderedLinePattern.test(lines[selectedIndex] ?? "")) continue;
    let first = selectedIndex; let last = selectedIndex;
    while (first > 0 && orderedLinePattern.test(lines[first - 1])) first--;
    while (last + 1 < lines.length && orderedLinePattern.test(lines[last + 1])) last++;
    const firstMatch = orderedLinePattern.exec(lines[first])!;
    if (Math.floor(firstMatch[1].replace(/\t/g, "    ").length / 4) > 0) {
      for (let index = first; index <= last; index++) visited.add(index);
      continue;
    }
    const counters: number[] = [];
    for (let index = first; index <= last; index++) {
      visited.add(index);
      const match = orderedLinePattern.exec(lines[index])!;
      const depth = Math.floor(match[1].replace(/\t/g, "    ").length / 4);
      if (depth === 0) counters.splice(0, counters.length, counters.length ? counters[0] + 1 : Number(match[2]));
      else {
        if (!counters.length) counters.push(1);
        if (counters.length > depth + 1) counters.length = depth + 1;
        while (counters.length < depth) counters.push(1);
        if (counters.length === depth) counters.push(1);
        else counters[depth] += 1;
      }
      lines[index] = `${match[1]}${counters[depth]}. ${match[4]}`;
    }
  }
}

function commonSuffixLength(left: string, right: string) {
  let length = 0;
  while (length < left.length && length < right.length && left[left.length - length - 1] === right[right.length - length - 1]) length++;
  return length;
}

/** Indent complete selected lines; four spaces also nest lists in the PDF renderer. */
export function indentMarkdown(source: string, selection: MarkdownSelection, outdent = false): MarkdownEdit {
  const start = Math.max(0, Math.min(selection.start, source.length));
  const end = Math.max(start, Math.min(selection.end, source.length));
  const first = start === 0 ? 0 : source.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && source[end - 1] === "\n" ? end - 1 : end;
  const originalLines = source.split("\n");
  const lines = [...originalLines];
  const selected = new Set<number>();
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart < first || lineStart > last) continue;
    selected.add(index);
    const removed = outdent ? (line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0) : 0;
    lines[index] = outdent ? line.slice(removed) : "    " + line;
  }
  normalizeOrderedBlocks(lines, selected);
  const starts = (values: string[]) => {
    const result: number[] = []; let position = 0;
    for (const line of values) { result.push(position); position += line.length + 1; }
    return result;
  };
  const oldStarts = starts(originalLines); const newStarts = starts(lines);
  const mapPosition = (position: number) => {
    let index = 0;
    for (let cursor = oldStarts.length - 1; cursor >= 0; cursor--) {
      if (oldStarts[cursor] <= position) { index = cursor; break; }
    }
    const column = Math.min(position - oldStarts[index], originalLines[index].length);
    const suffix = commonSuffixLength(originalLines[index], lines[index]);
    const oldPrefix = originalLines[index].length - suffix;
    const newPrefix = lines[index].length - suffix;
    const nextColumn = column >= oldPrefix
      ? newPrefix + column - oldPrefix
      : Math.max(0, Math.min(newPrefix, newPrefix - (oldPrefix - column)));
    return newStarts[index] + nextColumn;
  };
  return { markdown: lines.join("\n"), selection: { start: mapPosition(start), end: mapPosition(end) } };
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
    const bare = line.replace(/^(?:#{1,6}\s+|[-*+]\s+|(?:\d+\.)*\d+[.)]\s+|>\s?)/, "");
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
