// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export function markdownLineAt(markdown: string, offset: number) {
  const position = Math.max(0, Math.min(offset, markdown.length));
  const start = position === 0 ? 0 : markdown.lastIndexOf("\n", position - 1) + 1;
  const newline = markdown.indexOf("\n", position);
  return { index: markdown.slice(0, position).split("\n").length - 1, start, end: newline < 0 ? markdown.length : newline };
}

export function markdownLineStart(markdown: string, index: number) {
  const lines = markdown.split("\n");
  return lines.slice(0, Math.max(0, Math.min(index, lines.length - 1))).reduce((offset, line) => offset + line.length + 1, 0);
}

export function replaceMarkdownRange(markdown: string, start: number, end: number, text: string) {
  const from = Math.max(0, Math.min(start, markdown.length));
  const to = Math.max(from, Math.min(end, markdown.length));
  return { markdown: markdown.slice(0, from) + text + markdown.slice(to), offset: from + text.length };
}
