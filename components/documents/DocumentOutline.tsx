// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { getMarkdownHeadings } from "@/lib/protocol-markdown";

export function DocumentOutline({ markdown, activeLine, onJump }: { markdown: string; activeLine: number; onJump: (line: number) => void }) {
  const headings = getMarkdownHeadings(markdown);
  const active = headings.filter(heading => heading.line <= activeLine).at(-1)?.line;
  return <nav aria-label="Dokumentgliederung" className="space-y-1">
    <h2 className="mb-3 text-sm font-semibold">Gliederung</h2>
    {!headings.length && <p className="text-sm text-slate-500">Überschriften erscheinen hier automatisch. Mit H1, H2 und H3 kannst du das Dokument gliedern.</p>}
    {headings.map(heading => <button type="button" key={heading.slug} aria-current={active === heading.line ? "location" : undefined} onClick={() => onJump(heading.line)} className={`block w-full rounded py-2 pr-2 text-left text-sm hover:bg-slate-100 ${active === heading.line ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`} style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}>{heading.title.replace(/\*|`|<\/?u>/g, "")}</button>)}
  </nav>;
}
