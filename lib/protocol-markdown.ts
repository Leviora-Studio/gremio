// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { protocolFrontmatterRange } from "./protocol-frontmatter";

export const SESSION_PATTERN_VARIABLES = [
  "YYYY",
  "MM",
  "DD",
  "date",
  "session",
  "area",
] as const;

export const DECISION_PATTERN_VARIABLES = [
  "session",
  "top",
  "YYYY",
  "MM",
  "DD",
] as const;

export const TEMPLATE_VARIABLES = [
  "session.date",
  "session.date_de",
  "session.folder_name",
  "protocol_area.name",
  "created_at",
] as const;

const AGENDA_START = "<!-- gremio:agenda:start -->";
const AGENDA_END = "<!-- gremio:agenda:end -->";

function dateParts(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("Das Sitzungsdatum ist ungültig.");
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Das Sitzungsdatum ist ungültig.");
  }
  return { YYYY: m[1], MM: m[2], DD: m[3] };
}

export function applyPattern(
  pattern: string,
  values: Record<string, string>,
  allowed: readonly string[],
): string {
  if (/[{}]/.test(pattern.replace(/\{[^{}]+\}/g, ""))) {
    throw new Error("Das Muster enthält ungültige oder unvollständige Klammern.");
  }
  const unknown = [...pattern.matchAll(/\{([^{}]+)\}/g)]
    .map((m) => m[1])
    .filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`Unbekannter Platzhalter: {${unknown[0]}}.`);
  }
  return pattern.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? "");
}

export function renderSessionName(
  pattern: string,
  date: string,
  areaName: string,
  folderName?: string,
): string {
  const parts = dateParts(date);
  const value = applyPattern(
    pattern,
    {
      ...parts,
      date,
      session: folderName || date,
      area: areaName,
    },
    SESSION_PATTERN_VARIABLES,
  ).trim();
  if (!value || value === "." || value === "..") {
    throw new Error("Das Muster erzeugt keinen gültigen Namen.");
  }
  if (/[\\/\0]/.test(value) || value.startsWith(".")) {
    throw new Error("Namen dürfen keine Pfadtrenner oder versteckten Pfade enthalten.");
  }
  if (value.length > 120) throw new Error("Der erzeugte Name ist zu lang.");
  return value;
}

export function renderDecisionRef(
  pattern: string,
  session: string,
  sessionDate: string | null,
  top: string,
): string {
  const parts = sessionDate ? dateParts(sessionDate) : { YYYY: "", MM: "", DD: "" };
  const value = applyPattern(
    pattern,
    { session, top: top.trim(), ...parts },
    DECISION_PATTERN_VARIABLES,
  ).trim();
  if (!value) throw new Error("Das Beschlussreferenz-Muster erzeugt einen leeren Wert.");
  return value.slice(0, 200);
}

export function mayReplaceDecisionRef(
  current: string | null,
  previousAutomaticValues: (string | null | undefined)[],
): boolean {
  return !current || previousAutomaticValues.some((value) => value === current);
}

export function validateFilePattern(
  pattern: string,
  date: string,
  areaName: string,
  folderName: string,
): string {
  const value = renderSessionName(pattern, date, areaName, folderName);
  if (!value.toLowerCase().endsWith(".md")) {
    throw new Error("Der Name der Protokolldatei muss auf .md enden.");
  }
  return value;
}

export function renderProtocolTemplate(
  markdown: string,
  values: Record<(typeof TEMPLATE_VARIABLES)[number], string>,
): string {
  const unknown = [...markdown.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((key) => !TEMPLATE_VARIABLES.includes(key as never));
  if (unknown.length) {
    throw new Error(`Unbekannte Vorlagenvariable: {{${unknown[0]}}}.`);
  }
  return markdown.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (_, key: (typeof TEMPLATE_VARIABLES)[number]) => values[key],
  );
}

export function validateProtocolTemplate(markdown: string): void {
  renderProtocolTemplate(markdown, {
    "session.date": "2026-08-14",
    "session.date_de": "14.08.2026",
    "session.folder_name": "2026-08-14",
    "protocol_area.name": "Beispielgremium",
    created_at: "2026-08-14T12:00:00.000Z",
  });
}

export function markdownHeadingSlug(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Markdown-Zeilen außerhalb eingezäunter Codeblöcke samt Originalpositionen. */
function* markdownContentLines(markdown: string) {
  const frontmatter = protocolFrontmatterRange(markdown);
  let fence: { character: string; length: number } | null = null;
  let lineNumber = 0;
  for (const lineMatch of markdown.matchAll(/([^\n]*)(?:\n|$)/g)) {
    const line = lineMatch[1].replace(/\r$/, "");
    const currentLine = lineNumber++;
    if (frontmatter && lineMatch.index < frontmatter.bodyStart) continue;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const delimiter = fenceMatch[1];
      if (!fence) {
        fence = { character: delimiter[0], length: delimiter.length };
      } else if (delimiter[0] === fence.character && delimiter.length >= fence.length && !fenceMatch[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    yield {
      text: line,
      line: currentLine,
      start: lineMatch.index,
      end: lineMatch.index + lineMatch[0].length,
    };
  }
}

/** Gemeinsame Überschriftenerkennung für Tagesordnung und Vorschau-Anker. */
export function getMarkdownHeadings(markdown: string) {
  const counts = new Map<string, number>();
  const headings: { line: number; start: number; end: number; level: number; title: string; slug: string }[] = [];
  for (const line of markdownContentLines(markdown)) {
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line.text);
    if (!m) continue;
    const title = m[2].replace(/\s+#+\s*$/, "").trim();
    const base = markdownHeadingSlug(title);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    headings.push({
      line: line.line,
      start: line.start,
      end: line.end,
      level: m[1].length,
      title,
      slug: seen ? `${base}-${seen}` : base,
    });
  }
  return headings;
}

export function hasManagedAgenda(markdown: string): boolean {
  return markdown.includes(AGENDA_START) || markdown.includes("<!-- gremio:toc:start -->");
}

const ATTENDANCE_START = "<!-- gremio:attendance:members:start -->";
const ATTENDANCE_END = "<!-- gremio:attendance:members:end -->";

export type AttendanceMember = { id: number; name: string; present: boolean; proxyMemberId: number | null };

export function hasManagedAttendance(markdown: string): boolean {
  return markdown.includes(ATTENDANCE_START);
}

function tableCell(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\|`*_\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function ensureAttendanceSection(markdown: string): string {
  let source = markdown;
  const headings = getMarkdownHeadings(source);
  if (!headings.some(h => h.level === 2 && /^Anwesenheit$/i.test(h.title))) {
    const position = headings.find(h => h.level === 1)?.end ?? headings[0]?.start ?? source.length;
    const prefix = source.slice(0, position);
    source = `${prefix}${prefix ? (prefix.endsWith("\n") ? "\n" : "\n\n") : ""}## Anwesenheit\n\n${source.slice(position)}`;
  }
  return source;
}

/** Reuses the attendance/members section without touching guests, notes or TOPs. */
export function upsertMemberAttendance(markdown: string, members: AttendanceMember[]): string {
  let source = ensureAttendanceSection(markdown);
  let headings = getMarkdownHeadings(source);
  const attendance = headings.find(h => h.level === 2 && /^Anwesenheit$/i.test(h.title))!;
  const sectionEnd = headings.find(h => h.start > attendance!.start && h.level <= 2)?.start ?? source.length;
  let subsection = headings.find(h => h.level === 3 && h.start >= attendance!.end && h.start < sectionEnd && /^Mitglieder$/i.test(h.title));
  if (!subsection) {
    // Keep introductory attendance notes outside the removable subsection.
    const firstChild = headings.find(h => h.start >= attendance.end && h.start < sectionEnd && h.level >= 3)?.start ?? sectionEnd;
    const position = source.slice(attendance.end, firstChild).trim() ? firstChild : attendance.end;
    const prefix = source.slice(0, position);
    source = `${prefix}${prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n"}### Mitglieder\n\n${source.slice(position)}`;
    headings = getMarkdownHeadings(source);
    subsection = headings.find(h => h.level === 3 && h.start >= attendance!.end && /^Mitglieder$/i.test(h.title))!;
  }
  const bodyEnd = headings.find(h => h.start > subsection!.start && h.level <= 3)?.start ?? source.length;
  const body = source.slice(subsection.end, bodyEnd);
  const names = new Map(members.map(member => [member.id, member.name]));
  const table = [ATTENDANCE_START, "| Mitglied | Anwesend | übertragen auf |", "| --- | --- | --- |",
    ...members.map(member => `| ${tableCell(member.name)} | ${member.present ? "Ja" : "Nein"} | ${tableCell(names.get(member.proxyMemberId ?? -1) ?? "")} |`), ATTENDANCE_END].join("\n");
  const nextBody = upsertAttendanceTableBody(body, table, ATTENDANCE_START, ATTENDANCE_END, /^\|\s*Mitglied\s*\|\s*Anwesend\s*\|\s*übertragen auf\s*\|\s*$/i);
  const prefix = source.slice(0, subsection.end);
  return `${prefix}${prefix.endsWith("\n") ? "" : "\n"}${nextBody}${source.slice(bodyEnd)}`;
}

function upsertAttendanceTableBody(body: string, table: string, startMarker: string, endMarker: string, header: RegExp): string {
  const lines = [...markdownContentLines(body)];
  const managed: { start: number; end: number }[] = [];
  let blockStart: number | null = null;
  for (const line of lines) {
    if (line.text.trim() === startMarker) blockStart = line.start;
    if (line.text.trim() === endMarker && blockStart !== null) {
      managed.push({ start: blockStart, end: line.start + line.text.length });
      blockStart = null;
    }
  }
  let nextBody: string;
  if (managed.length) {
    nextBody = body;
    for (let index = managed.length - 1; index >= 0; index--) {
      const block = managed[index];
      nextBody = `${nextBody.slice(0, block.start)}${index === 0 ? table : ""}${nextBody.slice(block.end)}`;
    }
  } else {
    // Adopt only the matching unmarked attendance table, not unrelated tables/code.
    const start = lines.findIndex((line, i) => header.test(line.text)
      && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1]?.text ?? ""));
    if (start >= 0) {
      let end = start + 2;
      while (end < lines.length && lines[end].start === lines[end - 1].end && /^\|/.test(lines[end].text)) end++;
      nextBody = `${body.slice(0, lines[start].start)}${table}\n${body.slice(lines[end - 1].end)}`;
    } else nextBody = `\n${table}\n${body.startsWith("\n") ? body : `\n${body}`}`;
  }
  return nextBody;
}

const GUESTS_START = "<!-- gremio:attendance:guests:start -->";
const GUESTS_END = "<!-- gremio:attendance:guests:end -->";
export type AttendanceGuest = { name: string; affiliation: string; concern: string };

export function hasManagedGuests(markdown: string): boolean {
  return markdown.includes(GUESTS_START);
}

/** The guests subsection follows members; existing notes and other sections survive. */
export function upsertGuestAttendance(markdown: string, guests: AttendanceGuest[]): string {
  let source = ensureAttendanceSection(markdown);
  function sections() {
    const headings = getMarkdownHeadings(source);
    const attendance = headings.find(h => h.level === 2 && /^Anwesenheit$/i.test(h.title));
    const end = attendance ? headings.find(h => h.start > attendance.start && h.level <= 2)?.start ?? source.length : 0;
    const children = attendance ? headings.filter(h => h.level === 3 && h.start >= attendance.end && h.start < end) : [];
    return { headings, attendance: attendance!, member: children.find(h => /^Mitglieder$/i.test(h.title)), guest: children.find(h => /^Gäste$/i.test(h.title)) };
  }
  let { headings, attendance, member, guest } = sections();
  const insertionPosition = () => member
    ? headings.find(h => h.start > member!.start && h.level <= 3)?.start ?? source.length
    : headings.find(h => h.start > attendance.start && h.level <= 3)?.start ?? source.length;
  let position = insertionPosition();
  if (!guest || guest.start !== position) {
    let block = "### Gäste\n\n";
    if (guest) {
      const end = headings.find(h => h.start > guest!.start && h.level <= 3)?.start ?? source.length;
      block = source.slice(guest.start, end);
      source = source.slice(0, guest.start) + source.slice(end);
      ({ headings, attendance, member } = sections());
      position = insertionPosition();
    }
    source = `${source.slice(0, position)}${source.slice(0, position).endsWith("\n\n") ? "" : "\n\n"}${block}${block.endsWith("\n\n") ? "" : "\n\n"}${source.slice(position)}`;
    ({ headings, guest } = sections());
  }
  const end = headings.find(h => h.start > guest!.start && h.level <= 3)?.start ?? source.length;
  const table = [GUESTS_START, "| Name | Zugehörigkeit | Anliegen |", "| --- | --- | --- |",
    ...guests.map(row => `| ${tableCell(row.name)} | ${tableCell(row.affiliation)} | ${tableCell(row.concern)} |`), GUESTS_END].join("\n");
  const body = upsertAttendanceTableBody(source.slice(guest!.end, end), table, GUESTS_START, GUESTS_END, /^\|\s*Name\s*\|\s*Zugehörigkeit\s*\|\s*Anliegen\s*\|\s*$/i);
  const prefix = source.slice(0, guest!.end);
  return `${prefix}${prefix.endsWith("\n") ? "" : "\n"}${body}${source.slice(end)}`;
}

export type AttendanceSection = "members" | "guests";

function hiddenAttendanceMarker(section: AttendanceSection): string {
  return `<!-- gremio:attendance:${section}:hidden -->`;
}

/** A document-local flag survives cloud saves/reloads without changing person data. */
export function isAttendanceSectionIncluded(markdown: string, section: AttendanceSection): boolean {
  return ![...markdownContentLines(markdown)].some(line => line.text.trim() === hiddenAttendanceMarker(section));
}

function removeAttendanceSection(markdown: string, section: AttendanceSection): string {
  const headings = getMarkdownHeadings(markdown);
  const title = section === "members" ? /^Mitglieder$/i : /^Gäste$/i;
  const ranges: { start: number; end: number }[] = [];
  let inAttendance = false;
  for (const heading of headings) {
    if (heading.level <= 2) inAttendance = heading.level === 2 && /^Anwesenheit$/i.test(heading.title);
    if (inAttendance && heading.level === 3 && title.test(heading.title)) {
      ranges.push({ start: heading.start, end: headings.find(h => h.start > heading.start && h.level <= 3)?.start ?? markdown.length });
    }
  }
  let next = markdown;
  for (const range of ranges.reverse()) next = next.slice(0, range.start) + next.slice(range.end);
  return next;
}

function removeEmptyAttendanceSection(markdown: string): string {
  const headings = getMarkdownHeadings(markdown);
  let next = markdown;
  for (const heading of [...headings].reverse()) {
    if (heading.level !== 2 || !/^Anwesenheit$/i.test(heading.title)) continue;
    const end = headings.find(h => h.start > heading.start && h.level <= 2)?.start ?? markdown.length;
    if (!markdown.slice(heading.end, end).trim()) next = next.slice(0, heading.start) + next.slice(end);
  }
  return next;
}

export function setAttendanceSectionIncluded(markdown: string, section: AttendanceSection, included: boolean): string {
  const header = protocolFrontmatterRange(markdown);
  if (header) return header.closed ? markdown.slice(0, header.bodyStart) + setAttendanceSectionIncluded(markdown.slice(header.bodyStart), section, included) : markdown;
  let next = markdown;
  const markers = [...markdownContentLines(markdown)].filter(line => line.text.trim() === hiddenAttendanceMarker(section));
  for (const marker of markers.reverse()) next = next.slice(0, marker.start) + next.slice(marker.end);
  if (!included) next = `${hiddenAttendanceMarker(section)}\n${removeAttendanceSection(next, section)}`;
  return removeEmptyAttendanceSection(next);
}

/** Shared by the editor and server-side save, so both tables use the same snapshot. */
export function syncProtocolAttendance(markdown: string, members: AttendanceMember[], guests: AttendanceGuest[]): string {
  const header = protocolFrontmatterRange(markdown);
  if (header) return header.closed ? markdown.slice(0, header.bodyStart) + syncProtocolAttendance(markdown.slice(header.bodyStart), members, guests) : markdown;
  let next = isAttendanceSectionIncluded(markdown, "members")
    ? upsertMemberAttendance(markdown, members) : removeAttendanceSection(markdown, "members");
  next = isAttendanceSectionIncluded(markdown, "guests")
    ? upsertGuestAttendance(next, guests) : removeAttendanceSection(next, "guests");
  return removeEmptyAttendanceSection(next);
}

/** Minimal GFM table cells for the safe React preview, including escaped pipes. */
export function markdownTableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim().replace(/^\||\|$/g, "")) {
    if (escaped) { cell += character; escaped = false; }
    else if (character === "\\") escaped = true;
    else if (character === "|") { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells.map(value => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
}

/** Nutzt den vorhandenen Tagesordnungsabschnitt und aktualisiert nur dessen Liste. */
export function upsertAgenda(markdown: string): string {
  const header = protocolFrontmatterRange(markdown);
  if (header) return header.closed ? markdown.slice(0, header.bodyStart) + upsertAgenda(markdown.slice(header.bodyStart)) : markdown;
  const isAgenda = (heading: ReturnType<typeof getMarkdownHeadings>[number]) =>
    heading.level === 2 && /^Tagesordnung$/i.test(heading.title);
  let hasSection = getMarkdownHeadings(markdown).some(isAgenda);
  // Alte von Gremio erzeugte Inhaltsverzeichnisse werden einmalig umgestellt.
  let source = markdown.replace(/<!-- gremio:toc:start -->[\s\S]*?<!-- gremio:toc:end -->/g, () => {
    if (hasSection) return "";
    hasSection = true;
    return "## Tagesordnung";
  });
  if (!hasSection) {
    const title = getMarkdownHeadings(source).find((heading) => heading.level === 1);
    const position = title?.end ?? 0;
    source = `${source.slice(0, position)}${position ? "\n" : ""}## Tagesordnung\n\n${source.slice(position)}`;
  }

  const headings = getMarkdownHeadings(source);
  const section = headings.find(isAgenda)!;
  // Keine nachfolgenden Überschriften/Protokollinhalte anfassen, auch bei ### TOP.
  const bodyEnd = headings.find((heading) => heading.start >= section.end)?.start ?? source.length;
  const body = source.slice(section.end, bodyEnd);
  const lines = headings
    .filter((heading) => /^TOP\b/i.test(heading.title))
    .map((heading) => `- [${heading.title}](#${heading.slug})`);
  const block = [AGENDA_START, ...(lines.length ? lines : ["_Noch keine TOP-Überschriften._"]), AGENDA_END].join("\n");
  const managed = /<!-- gremio:agenda:start -->[\s\S]*?<!-- gremio:agenda:end -->/g;
  let nextBody: string;
  if (body.includes(AGENDA_START) && body.includes(AGENDA_END)) {
    let replaced = false;
    nextBody = body.replace(managed, () => {
      if (replaced) return "";
      replaced = true;
      return block;
    });
  } else {
    // Auch eine vorhandene unmarkierte Tagesordnungsliste übernehmen, z. B.
    // nachdem ein externer Editor Kommentare entfernt hat. Eigene Notizen bleiben.
    let list: { start: number; end: number } | undefined;
    for (const line of markdownContentLines(body)) {
      if (/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line.text)) {
        if (!list) list = { start: line.start, end: line.end };
        else if (line.start === list.end) list.end = line.end;
        else break;
      } else if (list) break;
    }
    nextBody = list
      ? `${body.slice(0, list.start)}${block}\n${body.slice(list.end)}`
      : `\n${block}\n${body.startsWith("\n") ? body : `\n${body}`}`;
  }
  const prefix = source.slice(0, section.end);
  return `${prefix.endsWith("\n") ? prefix : `${prefix}\n`}${nextBody}${source.slice(bodyEnd)}`;
}

export type FinanceBlockCard = {
  id: number;
  number: string | null;
  title: string;
  applicant: string;
  amount: number | null;
};

export function formatFinanceBlock(
  card: FinanceBlockCard,
  top: string,
  cardUrl: string,
): string {
  const amount = card.amount == null
    ? "—"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(card.amount / 100);
  return [
    `<!-- gremio:finance:start card=${card.id} -->`,
    `## TOP ${top.trim()} Finanzantrag ${card.title}`,
    "",
    `- Antragsnummer: ${card.number || "—"}`,
    `- Antragsteller: ${card.applicant || "—"}`,
    `- Beantragter Betrag: ${amount}`,
    `- [Finanzantrag in Gremio öffnen](${cardUrl})`,
    `<!-- gremio:finance:end card=${card.id} -->`,
  ].join("\n");
}

export function extractFinanceLinks(markdown: string): { cardId: number; top: string }[] {
  const links: { cardId: number; top: string }[] = [];
  const seen = new Set<number>();
  const headings = [...markdown.matchAll(/^##\s+TOP\s+([^\s]+).*$/gim)];
  for (const match of markdown.matchAll(/(?:\(gremio-card:(\d+)\)|\[Finanzantrag in Gremio öffnen\]\(https?:\/\/[^)\s]+\/intern\/card\/(\d+)(?:[?#][^)]*)?\))/g)) {
    const cardId = Number(match[1] ?? match[2]);
    if (!Number.isInteger(cardId) || seen.has(cardId)) continue;
    const heading = headings.filter((h) => (h.index ?? 0) < (match.index ?? 0)).at(-1);
    if (!heading) continue;
    seen.add(cardId);
    links.push({ cardId, top: heading[1] });
  }
  return links;
}
