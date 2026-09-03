// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

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

const TOC_START = "<!-- gremio:toc:start -->";
const TOC_END = "<!-- gremio:toc:end -->";

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

export function buildToc(markdown: string): string {
  const withoutExisting = removeToc(markdown);
  const counts = new Map<string, number>();
  const lines: string[] = [];
  for (const line of withoutExisting.split("\n")) {
    const m = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const title = m[2].replace(/\s+#+\s*$/, "").trim();
    const base = markdownHeadingSlug(title);
    if (!base) continue;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    const slug = seen ? `${base}-${seen}` : base;
    lines.push(`${"  ".repeat(m[1].length - 2)}- [${title}](#${slug})`);
  }
  return [TOC_START, "## Inhaltsverzeichnis", "", ...(lines.length ? lines : ["_Noch keine Überschriften._"]), TOC_END].join("\n");
}

export function removeToc(markdown: string): string {
  const start = markdown.indexOf(TOC_START);
  const end = markdown.indexOf(TOC_END);
  if (start < 0 || end < start) return markdown;
  return `${markdown.slice(0, start)}${markdown.slice(end + TOC_END.length)}`
    .replace(/^\n{3,}/, "\n\n")
    .replace(/\n{3,}$/g, "\n\n");
}

export function upsertToc(markdown: string): string {
  const toc = buildToc(markdown);
  const start = markdown.indexOf(TOC_START);
  const end = markdown.indexOf(TOC_END);
  if (start >= 0 && end >= start) {
    return `${markdown.slice(0, start)}${toc}${markdown.slice(end + TOC_END.length)}`;
  }
  const firstHeadingEnd = markdown.indexOf("\n");
  if (/^#\s+/.test(markdown) && firstHeadingEnd >= 0) {
    return `${markdown.slice(0, firstHeadingEnd + 1)}\n${toc}\n${markdown.slice(firstHeadingEnd + 1)}`;
  }
  return `${toc}\n\n${markdown}`;
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
