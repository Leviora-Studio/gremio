// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/** Literal, case-insensitive matches with offsets into the original text. */
export function findDocumentMatches(text: string, query: string) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return Array.from(text.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length }));
}

export function nextDocumentMatch(index: number, count: number, direction: number) {
  return count ? ((index + direction) % count + count) % count : 0;
}
