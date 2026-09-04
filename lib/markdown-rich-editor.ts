// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type RichLine = { prefix: string; content: string; kind: "heading" | "bullet" | "ordered" | "quote" | "plain"; level?: number; marker?: string };

const orderedLinePattern = /^([ \t]*)(\d+)[.)][ \t]+/;

/** Visible hierarchical markers for semantically nested Markdown ordered lists. */
export function orderedListDisplayMarkers(markdown: string): Map<number, string> {
  const markers = new Map<number, string>();
  let counters: number[] = [];
  markdown.split("\n").forEach((line, index) => {
    const match = orderedLinePattern.exec(line);
    if (!match) {
      if (line.trim()) counters = [];
      return;
    }
    const width = match[1].replace(/\t/g, "    ").length;
    const depth = Math.floor(width / 4);
    const value = Number(match[2]);
    if (depth === 0) counters = [value];
    else {
      if (depth > counters.length) {
        counters = [];
        markers.set(index, `${value}.`);
        return;
      }
      counters.length = Math.min(counters.length, depth + 1);
      counters[depth] = value;
    }
    markers.set(index, `${counters.slice(0, depth + 1).join(".")}.`);
  });
  return markers;
}

/** Split structural Markdown from the text users edit in the rich live mode. */
export function parseRichLine(line: string): RichLine {
  let match = /^( {0,3})(#{1,6})[ \t]+(.*)$/.exec(line);
  if (match) return { prefix: line.slice(0, line.length - match[3].length), content: match[3], kind: "heading", level: match[2].length };
  match = /^(\s*)([-*+])[ \t]+(.*)$/.exec(line);
  if (match) return { prefix: line.slice(0, line.length - match[3].length), content: match[3], kind: "bullet", marker: "•" };
  match = /^(\s*)(\d+[.)])[ \t]+(.*)$/.exec(line);
  if (match) return { prefix: line.slice(0, line.length - match[3].length), content: match[3], kind: "ordered", marker: match[2] };
  match = /^(\s*>[ \t]?)(.*)$/.exec(line);
  if (match) return { prefix: match[1], content: match[2], kind: "quote", marker: "›" };
  return { prefix: "", content: line, kind: "plain" };
}

export type InlineToken = { type: "text" | "escape" | "strong" | "em" | "underline" | "code" | "link" | "image"; source: string; children?: InlineToken[]; href?: string; raw?: string; width?: number };

/** A deliberately small inline grammar matching Gremio's preview and toolbar. */
export function parseInlineMarkdown(source: string, depth = 0): InlineToken[] {
  if (depth > 8 || !source) return source ? [{ type: "text", source }] : [];
  const tokens: InlineToken[] = [];
  const expression = /\\(?<escape>[\\`*{}\[\]()#+\-.!_|>])|`(?<code>[^`]+)`|!\[(?<image>(?:\\.|[^\]\\])*)\]\((?<imageHref>[^\s)]+)\)(?:\{\s*width=(?<width>\d{1,4})\s*\})?|\*\*(?<strong>.+?)\*\*|\*(?<em>[^*]+)\*|<u>(?<underline>.*?)<\/u>|\[(?<link>[^\]]+)\]\((?<href>https?:\/\/[^)\s]+|#[^)\s]+)\)/g;
  let cursor = 0;
  for (const match of source.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ type: "text", source: source.slice(cursor, index) });
    const groups = match.groups!;
    const type = (["escape", "code", "image", "strong", "em", "underline", "link"] as const).find(type => groups[type] !== undefined)!;
    tokens.push({ type, source: groups[type], ...(type === "image" ? { href: groups.imageHref, raw: match[0], width: groups.width ? Number(groups.width) : undefined } : type === "link" ? { href: groups.href } : {}), ...(!["code", "escape", "image"].includes(type) ? { children: parseInlineMarkdown(groups[type], depth + 1) } : {}) });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) tokens.push({ type: "text", source: source.slice(cursor) });
  return tokens;
}

export function inlineTokenMarkdown(type: InlineToken["type"], content: string, href = "") {
  if (type === "escape") return `\\${content}`;
  if (type === "strong") return `**${content}**`;
  if (type === "em") return `*${content}*`;
  if (type === "underline") return `<u>${content}</u>`;
  if (type === "code") return `\`${content.replace(/`/g, "\\`")}\``;
  if (type === "link") return `[${content}](${href})`;
  if (type === "image") return `![${content}](${href})`;
  return content;
}

export function tableCellRanges(line: string) {
  if (!line.trim().startsWith("|")) return [];
  const ranges: { start: number; end: number; content: string }[] = [];
  const pipes: number[] = [];
  let escapes = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "|" && escapes % 2 === 0) pipes.push(index);
    escapes = line[index] === "\\" ? escapes + 1 : 0;
  }
  for (let index = 0; index < pipes.length - 1; index++) {
    const rawStart = pipes[index] + 1; const rawEnd = pipes[index + 1];
    // Only the conventional single padding space belongs to the delimiter.
    // Further spaces are editable content (in particular a just-typed space).
    const start = rawStart + (/\s/.test(line[rawStart] ?? "") && rawStart < rawEnd ? 1 : 0);
    const end = Math.max(start, rawEnd - (/\s/.test(line[rawEnd - 1] ?? "") ? 1 : 0));
    ranges.push({ start, end, content: line.slice(start, end) });
  }
  return ranges;
}

/** Pipes typed in a rendered cell are text, never new column delimiters. */
export function escapeTableInput(text: string) {
  return text.replace(/\r\n?|\n/g, " ").replace(/\|/g, "\\|");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only our own escaped, whitelisted markup enters the editable DOM. */
export function richInlineHtml(source: string, plain = false, interactiveLinks = false, imageUrl?: (reference: string) => string | null): string {
  if (plain) return escapeHtml(source);
  const render = (token: InlineToken): string => {
    if (token.type === "text") return escapeHtml(token.source);
    if (token.type === "image") {
      const url = imageUrl?.(token.href ?? "");
      if (!url) return escapeHtml(token.raw ?? "");
      const width = token.width ? ` width="${Math.max(48, Math.min(1600, token.width))}"` : "";
      return `<img data-md-token="image" data-md-source="${escapeHtml(token.raw ?? "")}" contenteditable="false" draggable="false" src="${escapeHtml(url)}" alt="${escapeHtml(token.source.replace(/\\([\\\[\]])/g, "$1"))}"${width} class="block h-auto max-w-full rounded" />`;
    }
    const tag = { strong: "strong", em: "em", underline: "u", code: "code", link: interactiveLinks ? "a" : "span", escape: "span" }[token.type];
    const content = token.children ? token.children.map(render).join("") : escapeHtml(token.source);
    const link = token.type === "link" ? ` data-md-href="${escapeHtml(token.href ?? "")}" class="text-brand-600 underline"${interactiveLinks ? ` href="${escapeHtml(token.href ?? "")}"${token.href?.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}` : ""}` : "";
    return `<${tag} data-md-token="${token.type}"${link}>${content}</${tag}>`;
  };
  return parseInlineMarkdown(source).map(render).join("");
}
