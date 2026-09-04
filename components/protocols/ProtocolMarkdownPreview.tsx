// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { ReactNode } from "react";
import { getMarkdownHeadings, markdownTableCells } from "@/lib/protocol-markdown";
import { protocolFrontmatterRange } from "@/lib/protocol-frontmatter";

/** Both preview modes share the same renderer; live editing replaces only one source line. */
export function ProtocolMarkdownPreview({ markdown, activeLine, editor }: { markdown: string; activeLine?: number; editor?: ReactNode }) {
  const lines = markdown.split("\n");
  const headings = new Map(getMarkdownHeadings(markdown).map(heading => [heading.line, heading]));
  const tableRows = new Set<number>();
  const header = protocolFrontmatterRange(markdown);
  const headerLines = header?.closed ? markdown.slice(0, header.bodyStart).split("\n").length - (markdown[header.bodyStart - 1] === "\n" ? 1 : 0) : 0;
  return <>
    {lines.map((line, index) => {
      if (index < headerLines) return index === activeLine ? <div key={index} data-markdown-line={index}>{editor}</div> : null;
      if (tableRows.has(index)) return null;
      if (line.trim().startsWith("|") && /^\|[\s:|-]+\|\s*$/.test(lines[index + 1]?.trim() ?? "")) {
        const header = markdownTableCells(line);
        tableRows.add(index + 1);
        const rows: { cells: string[]; line: number }[] = [];
        for (let next = index + 2; next < lines.length && lines[next].trim().startsWith("|"); next++) {
          tableRows.add(next); rows.push({ cells: markdownTableCells(lines[next]), line: next });
        }
        return <div key={index} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead><tr data-markdown-line={index}>{activeLine === index
              ? <th colSpan={Math.max(1, header.length)}>{editor}</th>
              : header.map((cell, i) => <th key={i} className="border border-slate-300 bg-slate-50 p-2">{inlineMarkdown(cell)}</th>)}</tr></thead>
            <tbody>
              {activeLine === index + 1 && <tr><td colSpan={Math.max(1, header.length)}>{editor}</td></tr>}
              {rows.map(row => <tr key={row.line} data-markdown-line={row.line}>{activeLine === row.line
                ? <td colSpan={Math.max(1, header.length)}>{editor}</td>
                : row.cells.map((cell, j) => <td key={j} className="border border-slate-300 p-2">{inlineMarkdown(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>;
      }
      if (index === activeLine) return <div key={index} data-markdown-line={index}>{editor}</div>;
      if (/^<!--/.test(line)) return null;
      const heading = headings.get(index);
      if (heading) {
        const className = heading.level === 1 ? "text-2xl font-bold" : heading.level === 2 ? "text-xl font-semibold" : "text-lg font-semibold";
        return <div key={index} data-markdown-line={index} id={heading.slug} className={className}>{inlineMarkdown(heading.title)}</div>;
      }
      const bullet = /^[-*]\s+(.+)/.exec(line);
      if (bullet) return <div key={index} data-markdown-line={index} className="pl-4">• {inlineMarkdown(bullet[1])}</div>;
      const ordered = /^(\d+)[.)]\s+(.+)/.exec(line);
      if (ordered) return <div key={index} data-markdown-line={index} className="pl-4">{ordered[1]}. {inlineMarkdown(ordered[2])}</div>;
      const quote = /^>\s?(.*)/.exec(line);
      if (quote) return <blockquote key={index} data-markdown-line={index} className="border-l-2 border-slate-300 pl-4 text-slate-600">{inlineMarkdown(quote[1])}</blockquote>;
      if (!line.trim()) return <div key={index} data-markdown-line={index} className="h-2" />;
      return <p key={index} data-markdown-line={index} className="whitespace-pre-wrap">{inlineMarkdown(line)}</p>;
    })}
  </>;
}

function inlineMarkdown(text: string, depth = 0): ReactNode {
  if (depth > 8) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  const tokens = /`([^`]+)`|\*\*(.+?)\*\*|\*([^*]+)\*|<u>(.*?)<\/u>|\[([^\]]+)\]\((https?:\/\/[^)]+|#[^)]+)\)/g;
  for (const match of text.matchAll(tokens)) {
    const index = match.index ?? 0;
    parts.push(text.slice(cursor, index));
    if (match[1] !== undefined) parts.push(<code key={index} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">{match[1]}</code>);
    else if (match[2] !== undefined) parts.push(<strong key={index}>{inlineMarkdown(match[2], depth + 1)}</strong>);
    else if (match[3] !== undefined) parts.push(<em key={index}>{inlineMarkdown(match[3], depth + 1)}</em>);
    else if (match[4] !== undefined) parts.push(<u key={index}>{inlineMarkdown(match[4], depth + 1)}</u>);
    else parts.push(<a key={index} href={match[6]} className="text-brand-600 underline" target={match[6].startsWith("http") ? "_blank" : undefined} rel="noopener">{inlineMarkdown(match[5], depth + 1)}</a>);
    cursor = index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

export const protocolPreviewClassName = "min-h-[38rem] space-y-2 break-words rounded-md border border-slate-200 bg-white p-5 text-sm";
