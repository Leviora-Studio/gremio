// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { protocolFrontmatterRange } from "./protocol-frontmatter";

export const RESULT_LABELS = [
  "Abstimmungsergebnis",
  "Zuständigkeit",
  "Feststellung",
  "Beschlossen",
  "Abstimmung",
  "Beschluss",
  "Ergebnis",
  "Zuständig",
  "Aufgabe",
  "Frist",
] as const;

export type ResultSourceBlock = {
  id: string;
  start: number;
  end: number;
  markdown: string;
  detectedAs: string | null;
  automatic: boolean;
  selectable: boolean;
  kind: RawBlock["kind"];
  headingLevel?: number;
};

export type ResultSourceTop = {
  id: string;
  heading: string;
  title: string;
  start: number;
  blocks: ResultSourceBlock[];
};

export type ResultProtocolAnalysis = {
  frontmatter: string | null;
  title: string | null;
  prelude: ResultSourceBlock[];
  tops: ResultSourceTop[];
};

type RawBlock = {
  start: number;
  end: number;
  markdown: string;
  kind: "heading" | "paragraph" | "list" | "table" | "code" | "frontmatter";
  headingLevel?: number;
  headingTitle?: string;
  top?: boolean;
  label?: string;
  labelHasContent?: boolean;
  selectable: boolean;
};

function cleanHeadingTitle(value: string): string {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

function meaningful(value: string): boolean {
  return value.replace(/<!--[^]*?-->/g, "").replace(/[*_~`:#>\s-]/g, "").length > 0;
}

const LABEL_PATTERN = RESULT_LABELS.join("|");

function leadingLabel(markdown: string, kind: RawBlock["kind"]): { label: string; hasContent: boolean } | null {
  let first = markdown.split(/\r?\n/, 1)[0].trim();
  if (kind === "heading") first = first.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
  else first = first.replace(/^(?:[-+*]|\d+[.)])\s+/, "").replace(/^>\s*/, "");
  const emphasis = "(?:\\*\\*|__|\\*|_|~~)";
  const match = new RegExp(`^${emphasis}?(${LABEL_PATTERN})(?::${emphasis}?|${emphasis}:|:)\\s*(.*)$`, "i").exec(first)
    ?? (kind === "heading" ? new RegExp(`^${emphasis}?(${LABEL_PATTERN})${emphasis}?\\s*$`, "i").exec(first) : null);
  if (!match) return null;
  const canonical = RESULT_LABELS.find(label => label.toLocaleLowerCase("de-DE") === match[1].toLocaleLowerCase("de-DE")) ?? match[1];
  return { label: canonical, hasContent: meaningful(match[2] ?? "") || markdown.split(/\r?\n/).slice(1).some(meaningful) };
}

function lineRecords(markdown: string) {
  const records: { start: number; end: number; text: string }[] = [];
  for (const match of markdown.matchAll(/([^\n]*)(?:\n|$)/g)) {
    if (match.index === markdown.length && !match[0]) break;
    records.push({ start: match.index, end: match.index + match[0].length, text: match[1].replace(/\r$/, "") });
  }
  return records;
}

function rawBlocks(markdown: string): RawBlock[] {
  const lines = lineRecords(markdown);
  const frontmatter = protocolFrontmatterRange(markdown);
  const blocks: RawBlock[] = [];
  let index = 0;
  if (frontmatter) {
    blocks.push({ start: 0, end: frontmatter.bodyStart, markdown: markdown.slice(0, frontmatter.bodyStart), kind: "frontmatter", selectable: false });
    while (index < lines.length && lines[index].start < frontmatter.bodyStart) index++;
  }
  while (index < lines.length) {
    const line = lines[index];
    if (!line.text.trim()) { index++; continue; }
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence) {
      const character = fence[1][0]; const length = fence[1].length; let end = line.end; index++;
      while (index < lines.length) {
        end = lines[index].end;
        const close = new RegExp(`^ {0,3}${character === "`" ? "`" : "~"}{${length},}\\s*$`).test(lines[index].text);
        index++; if (close) break;
      }
      blocks.push({ start: line.start, end, markdown: markdown.slice(line.start, end), kind: "code", selectable: true });
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line.text);
    if (heading) {
      const title = cleanHeadingTitle(heading[2]);
      const level = heading[1].length;
      const block: RawBlock = { start: line.start, end: line.end, markdown: markdown.slice(line.start, line.end), kind: "heading", headingLevel: level, headingTitle: title, top: /^TOP\b/i.test(title), selectable: level !== 1 };
      const label = leadingLabel(block.markdown, block.kind); if (label) Object.assign(block, { label: label.label, labelHasContent: label.hasContent });
      blocks.push(block); index++; continue;
    }
    const isList = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line.text);
    const isTable = /^\s*\|/.test(line.text);
    const kind: RawBlock["kind"] = isList ? "list" : isTable ? "table" : "paragraph";
    const start = line.start; let end = line.end; index++;
    while (index < lines.length && lines[index].text.trim()) {
      const next = lines[index].text;
      if (/^ {0,3}(?:#{1,6})[ \t]+/.test(next) || /^ {0,3}(`{3,}|~{3,})/.test(next)) break;
      if (kind === "list" && /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(next)) break;
      if (kind === "table" && !/^\s*\|/.test(next)) break;
      if (kind === "paragraph" && (/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(next) || /^\s*\|/.test(next))) break;
      end = lines[index].end; index++;
    }
    const block: RawBlock = { start, end, markdown: markdown.slice(start, end), kind, selectable: true };
    const label = leadingLabel(block.markdown, block.kind); if (label) Object.assign(block, { label: label.label, labelHasContent: label.hasContent });
    blocks.push(block);
  }
  return blocks;
}

function sourceBlock(raw: RawBlock, end = raw.end, detectedAs: string | null = null): ResultSourceBlock {
  return { id: `source-${raw.start}-${end}`, start: raw.start, end, markdown: raw.markdown.slice(0, end - raw.start), detectedAs, automatic: !!detectedAs, selectable: raw.selectable, kind: raw.kind, headingLevel: raw.headingLevel };
}

function sectionBlocks(markdown: string, blocks: RawBlock[]): ResultSourceBlock[] {
  const result: ResultSourceBlock[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (!block.label) { result.push(sourceBlock(block)); continue; }
    let endIndex = index;
    if (block.kind === "heading") {
      const level = block.headingLevel ?? 6;
      for (let cursor = index + 1; cursor < blocks.length; cursor++) {
        const next = blocks[cursor];
        if (next.top || next.label || (next.kind === "heading" && (next.headingLevel ?? 6) <= level)) break;
        endIndex = cursor;
      }
    } else if (!block.labelHasContent) {
      const next = blocks[index + 1];
      if (next && !next.top && !next.label && next.kind !== "frontmatter") {
        endIndex = index + 1;
        // A following Markdown list consists of all adjacent list items, not
        // merely the first visual line/item.
        if (next.kind === "list") {
          while (blocks[endIndex + 1]?.kind === "list" && blocks[endIndex + 1].start === blocks[endIndex].end) endIndex++;
        }
      }
    }
    const end = blocks[endIndex].end;
    const content = markdown.slice(block.start, end);
    const hasContent = block.labelHasContent || endIndex > index && meaningful(markdown.slice(block.end, end));
    if (!hasContent) { result.push(sourceBlock(block)); continue; }
    result.push({ id: `source-${block.start}-${end}`, start: block.start, end, markdown: content, detectedAs: block.label, automatic: true, selectable: true, kind: block.kind, headingLevel: block.headingLevel });
    index = endIndex;
  }
  return result;
}

/** Deterministic source analysis. Frontmatter and fenced code are never auto-detected. */
export function analyzeResultProtocol(markdown: string): ResultProtocolAnalysis {
  const raw = rawBlocks(markdown);
  const frontmatterRange = protocolFrontmatterRange(markdown);
  const frontmatter = frontmatterRange?.closed ? markdown.slice(0, frontmatterRange.bodyStart) : null;
  const firstH1 = raw.find(block => block.kind === "heading" && block.headingLevel === 1 && !block.top);
  const title = firstH1?.headingTitle ?? null;
  const tops: ResultSourceTop[] = [];
  const preludeRaw: RawBlock[] = [];
  let current: { top: ResultSourceTop; raw: RawBlock[] } | null = null;
  for (const block of raw) {
    if (block.top && block.kind === "heading") {
      if (current) current.top.blocks = sectionBlocks(markdown, current.raw);
      const top: ResultSourceTop = { id: `top-${block.start}`, heading: block.markdown, title: block.headingTitle ?? "TOP", start: block.start, blocks: [] };
      tops.push(top); current = { top, raw: [] };
    } else if (current) current.raw.push(block);
    else preludeRaw.push(block);
  }
  if (current) current.top.blocks = sectionBlocks(markdown, current.raw);
  const prelude = sectionBlocks(markdown, preludeRaw).map(block => ({ ...block, automatic: false }));
  return { frontmatter, title, prelude, tops };
}

function blockStart(id: string) { return `<!-- gremio:result:source:start id=${id} -->`; }
function blockEnd(id: string) { return `<!-- gremio:result:source:end id=${id} -->`; }
function topStart(id: string) { return `<!-- gremio:result:top:start id=${id} -->`; }
function topEnd(id: string) { return `<!-- gremio:result:top:end id=${id} -->`; }

function wrappedBlock(block: ResultSourceBlock, markdown = block.markdown): string {
  return `${blockStart(block.id)}\n${markdown.trimEnd()}\n${blockEnd(block.id)}`;
}

function composeResult(parts: string[]): string {
  // Keep an existing leading YAML block byte-for-byte; only normalize the
  // boundaries introduced between managed result blocks.
  const values = parts.map((part, index) => index === 0 ? part.trimEnd() : part.trim()).filter(part => part.trim());
  let result = values[0] ?? "";
  for (const value of values.slice(1)) {
    const markerBoundary = result.trimEnd().endsWith("-->") || value.trimStart().startsWith("<!--");
    result += `${markerBoundary ? "\n" : "\n\n"}${value}`;
  }
  return `${result}\n`;
}

function topSection(top: ResultSourceTop, blocks: ResultSourceBlock[]): string {
  return `${topStart(top.id)}\n${top.heading.trimEnd()}\n${blocks.map(block => wrappedBlock(block)).join("\n")}\n${topEnd(top.id)}`;
}

export function initialResultProtocol(analysis: ResultProtocolAnalysis, folderName: string): string {
  const parts = [`# Ergebnisprotokoll – ${analysis.title ?? folderName}`];
  for (const top of analysis.tops) {
    const selected = top.blocks.filter(block => block.automatic);
    if (!selected.length) continue;
    parts.push(topSection(top, selected));
  }
  const result = composeResult(parts);
  if (!analysis.frontmatter) return result;
  const newline = analysis.frontmatter.includes("\r\n") ? "\r\n" : "\n";
  return `${analysis.frontmatter}${analysis.frontmatter.endsWith("\n") ? "" : newline}${result}`;
}

export function selectedResultSourceIds(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/<!-- gremio:result:source:start id=(source-\d+-\d+) -->/g)].map(match => match[1]));
}

function findBlock(analysis: ResultProtocolAnalysis, id: string) {
  for (const top of analysis.tops) {
    const block = top.blocks.find(item => item.id === id); if (block) return { block, top };
  }
  const block = analysis.prelude.find(item => item.id === id); return block ? { block, top: null } : null;
}

export function structuralResultSourceIds(analysis: ResultProtocolAnalysis, id: string): string[] {
  const found = findBlock(analysis, id); if (!found) return [];
  const section = found.top?.blocks ?? analysis.prelude;
  const ancestors: ResultSourceBlock[] = [];
  for (const block of section) {
    if (block.id === id) {
      if (block.kind === "heading" && block.headingLevel) {
        while (ancestors.at(-1)?.headingLevel && ancestors.at(-1)!.headingLevel! >= block.headingLevel) ancestors.pop();
      }
      break;
    }
    if (block.kind !== "heading" || !block.headingLevel || block.headingLevel === 1) continue;
    while (ancestors.at(-1)?.headingLevel && ancestors.at(-1)!.headingLevel! >= block.headingLevel) ancestors.pop();
    ancestors.push(block);
  }
  return [...ancestors, found.block].filter(block => block.selectable).map(block => block.id);
}

function laterInsertion(markdown: string, analysis: ResultProtocolAnalysis, sourceStart: number): number {
  const candidates = [
    ...analysis.prelude.filter(block => block.start > sourceStart).map(block => ({ start: block.start, marker: blockStart(block.id) })),
    ...analysis.tops.filter(top => top.start > sourceStart).map(top => ({ start: top.start, marker: topStart(top.id) })),
  ].sort((a, b) => a.start - b.start);
  for (const candidate of candidates) {
    const index = markdown.indexOf(candidate.marker);
    if (index >= 0) return index;
  }
  return markdown.length;
}

export function addResultSource(markdown: string, analysis: ResultProtocolAnalysis, id: string, restored?: string): string {
  if (selectedResultSourceIds(markdown).has(id)) return markdown;
  const found = findBlock(analysis, id); if (!found) return markdown;
  const wrapped = wrappedBlock(found.block, restored ?? found.block.markdown);
  if (!found.top) {
    const insertion = laterInsertion(markdown, analysis, found.block.start);
    return composeResult([markdown.slice(0, insertion), wrapped, markdown.slice(insertion)]);
  }
  const endMarker = topEnd(found.top.id);
  const topEndIndex = markdown.indexOf(endMarker);
  if (topEndIndex < 0) {
    const insertion = laterInsertion(markdown, analysis, found.top.start);
    return composeResult([markdown.slice(0, insertion), topSection(found.top, [found.block]), markdown.slice(insertion)]);
  }
  const later = found.top.blocks
    .filter(block => block.start > found.block.start)
    .map(block => ({ block, index: markdown.indexOf(blockStart(block.id)) }))
    .find(item => item.index >= 0);
  const insertion = later?.index ?? topEndIndex;
  return composeResult([markdown.slice(0, insertion), wrapped, markdown.slice(insertion)]);
}

export type RemoveResultSource = { markdown: string; status: "removed" | "modified" | "detached"; retained?: string };

export function removeResultSource(markdown: string, analysis: ResultProtocolAnalysis, id: string, force = false): RemoveResultSource {
  const found = findBlock(analysis, id); if (!found) return { markdown, status: "detached" };
  const startMarker = blockStart(id); const endMarker = blockEnd(id);
  const start = markdown.indexOf(startMarker); const endStart = markdown.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || endStart < 0) return { markdown, status: "detached" };
  const innerStart = start + startMarker.length;
  const retained = markdown.slice(innerStart, endStart).replace(/^\n/, "").replace(/\n$/, "");
  if (!force && retained.trimEnd() !== found.block.markdown.trimEnd()) return { markdown, status: "modified", retained };
  const end = endStart + endMarker.length;
  let next = composeResult([markdown.slice(0, start), markdown.slice(end)]);
  if (found.top) {
    const topStartMarker = topStart(found.top.id); const topEndMarker = topEnd(found.top.id);
    const sectionStart = next.indexOf(topStartMarker); const sectionEndStart = next.indexOf(topEndMarker, sectionStart + topStartMarker.length);
    if (sectionStart >= 0 && sectionEndStart >= 0) {
      const sectionBody = next.slice(sectionStart + topStartMarker.length, sectionEndStart);
      const withoutHeading = sectionBody.replace(/^\s*/, "").slice(found.top.heading.trimEnd().length);
      if (!withoutHeading.includes("gremio:result:source:start") && !meaningful(withoutHeading)) {
        next = composeResult([next.slice(0, sectionStart), next.slice(sectionEndStart + topEndMarker.length)]);
      }
    }
  }
  return { markdown: composeResult([next]), status: "removed", retained };
}
