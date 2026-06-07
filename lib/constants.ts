// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Zentrale Konstanten für Stammdaten, Default-Vorlagen und Feldschlüssel.

// Beispiel-Standorte (Startbestand via `npm run db:seed`) — beliebig anpassbar.
export const LOCATION_NAMES = [
  "Standort A",
  "Standort B",
  "Standort C",
  "Zentrale",
] as const;

// Default-Status-Vorlage für neue Boards (Reihenfolge = position).
export const DEFAULT_STATUSES: { name: string; isArchiveTrigger?: boolean }[] = [
  { name: "Eingegangen" },
  { name: "Geprüft / Geplant für Sitzung" },
  { name: "Angenommen / Abgelehnt" },
  { name: "Wartend auf Auflagen" },
  { name: "Warten auf Antwort" },
  { name: "Anweisung erfolgt", isArchiveTrigger: true },
];

// Anhang-Typen: benannte Slots (je max. 1) + "other" (unbegrenzt).
export const ATTACHMENT_KINDS = [
  "finance_request",
  "annex_a",
  "annex_b",
  "student_card",
  "other",
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const NAMED_SLOT_KINDS: AttachmentKind[] = [
  "finance_request",
  "annex_a",
  "annex_b",
  "student_card",
];

// Pro Board konfigurierbare Kartenfelder (Sichtbarkeit). Titel, Erstellungs-
// zeitpunkt und Letzte Änderung sind IMMER sichtbar und nicht enthalten.
// "titel" ist immer sichtbar und daher NICHT abschaltbar (nicht enthalten).
export const CARD_FIELD_KEYS = [
  "number",
  "applicant",
  "budget_title",
  "approved_amount",
  "actual_amount",
  "creator",
  "assignee",
  "deadline",
  "meeting",
  "decision_ref",
  "instruction_date",
  "priority",
  "account",
  "finance_request",
  "annex_a",
  "annex_b",
  "student_card",
  "other_pdfs",
  "notes",
  "applicant_note",
] as const;
export type CardFieldKey = (typeof CARD_FIELD_KEYS)[number];

// Anhang-Slots (eigener Bereich, nicht im Felder-Grid sortierbar)
export const ATTACHMENT_FIELD_KEYS = [
  "finance_request",
  "annex_a",
  "annex_b",
  "student_card",
  "other_pdfs",
] as const;

// Editierbare Felder (im Felder-Grid, Reihenfolge pro Board einstellbar)
export const EDITABLE_FIELD_KEYS = CARD_FIELD_KEYS.filter(
  (k) => !ATTACHMENT_FIELD_KEYS.includes(k as (typeof ATTACHMENT_FIELD_KEYS)[number]),
);

export const CARD_FIELD_LABELS: Record<CardFieldKey, string> = {
  number: "Antragsnummer",
  applicant: "Antragsteller",
  budget_title: "Haushaltstitel",
  approved_amount: "Genehmigter Betrag (€)",
  actual_amount: "Tatsächliche Ausgaben (€)",
  instruction_date: "Anweisungsdatum",
  creator: "Ersteller",
  assignee: "Zugewiesen zu",
  deadline: "Deadline",
  meeting: "Sitzung",
  decision_ref: "Beschlussreferenz",
  priority: "Priorität",
  account: "Konto",
  finance_request: "Finanzantrag",
  annex_a: "Anlage A",
  annex_b: "Anlage B",
  student_card: "Studierendenausweis",
  other_pdfs: "Dateien (PDF)",
  notes: "Notizen",
  applicant_note: "Hinweis für Antragsteller",
};

// Default-Prioritäten, die beim ersten Start angelegt werden (frei im Admin
// verwaltbar — Anzahl, Bezeichnung und Farbe sind danach nicht mehr fest).
export const DEFAULT_PRIORITIES: { label: string; color: string }[] = [
  { label: "Niedrig", color: "slate" },
  { label: "Mittel", color: "amber" },
  { label: "Hoch", color: "red" },
];

// Auswählbare Badge-Farben für Prioritäten (im Admin-Panel anpassbar).
// Die Klassen müssen statisch im Quelltext stehen, damit Tailwind sie behält.
export const PRIORITY_COLOR_OPTIONS = [
  { value: "slate", label: "Grau", badge: "bg-slate-100 text-slate-600" },
  { value: "blue", label: "Blau", badge: "bg-blue-100 text-blue-700" },
  { value: "green", label: "Grün", badge: "bg-green-100 text-green-700" },
  { value: "amber", label: "Gelb", badge: "bg-amber-100 text-amber-700" },
  { value: "orange", label: "Orange", badge: "bg-orange-100 text-orange-700" },
  { value: "red", label: "Rot", badge: "bg-red-100 text-red-700" },
  { value: "violet", label: "Violett", badge: "bg-violet-100 text-violet-700" },
] as const;

export function priorityBadgeClass(color: string): string {
  return (
    PRIORITY_COLOR_OPTIONS.find((o) => o.value === color)?.badge ??
    "bg-slate-100 text-slate-600"
  );
}

// Welche Anhänge auf der öffentlichen Statusseite (per Token) sichtbar sind.
// Der Studierendenausweis bleibt bewusst intern.
export const PUBLIC_ATTACHMENT_KINDS = [
  "finance_request",
  "annex_a",
  "annex_b",
  "other",
] as const;

// Maximale Anzahl öffentlich nachgereichter Dateien (Missbrauchsschutz).
export const MAX_PUBLIC_OTHER_FILES = 30;

// Felder, aus denen der Nextcloud-Archiv-Ordnername gebaut werden kann
// (pro Board konfigurierbar). Reihenfolge = Reihenfolge im Ordnernamen.
export const ARCHIVE_FOLDER_FIELDS = [
  { key: "number", label: "Antragsnummer", example: "A2_2026" },
  { key: "title", label: "Titel", example: "Grillabend am FB5" },
  { key: "applicant", label: "Antragsteller", example: "Max Mustermann" },
  { key: "budget_title", label: "Haushaltstitel", example: "427 11" },
  { key: "meeting", label: "Sitzung", example: "2026-04-01" },
  { key: "instruction_date", label: "Anweisungsdatum", example: "2026-05-01" },
  { key: "deadline", label: "Deadline", example: "2026-06-01" },
  { key: "id", label: "Karten-ID", example: "42" },
] as const;
export const ARCHIVE_FOLDER_FIELD_KEYS = ARCHIVE_FOLDER_FIELDS.map((f) => f.key);
export const DEFAULT_ARCHIVE_FOLDER_FIELDS = "number,title";
// Leeres Eingabefeld → Leerzeichen als Trennzeichen.
export const DEFAULT_ARCHIVE_FOLDER_SEPARATOR = " ";

// Upload-Limits & erlaubte MIME-Typen
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB pro Datei (einzige Grenze)
export const PDF_MIME = ["application/pdf"];
export const AUSWEIS_MIME = ["application/pdf", "image/png", "image/jpeg"];
export const AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"];

export const TOKEN_LENGTH = 30;
export const TOKEN_ALPHABET =
  "0123456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
