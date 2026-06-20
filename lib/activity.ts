// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { db } from "@/lib/db";
import { cardActivity } from "@/lib/db/schema";

export type ActivityType =
  | "created"
  | "status"
  | "assignee"
  | "deadline"
  | "attachment_added"
  | "attachment_removed"
  | "archive"
  | "archive_failed";

/** YYYY-MM-DD → DD.MM.YYYY (für Aktivitätstexte); Ungültiges → Rohwert. */
function deDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

/**
 * Vorgerenderter deutscher Aktivitätstext für eine Deadline-Änderung. Der
 * Zeitpunkt der Änderung steckt ohnehin in `card_activity.created_at`; hier wird
 * zusätzlich der NEUE Wert (und ggf. der alte) festgehalten.
 */
export function deadlineActivityDetail(
  oldVal: string | null,
  newVal: string | null,
): string {
  if (!newVal) return "Deadline entfernt";
  if (!oldVal) return `Deadline gesetzt: ${deDate(newVal)}`;
  return `Deadline geändert: ${deDate(oldVal)} → ${deDate(newVal)}`;
}

/**
 * Vorgerenderter Text für eine Zuweisungs-Änderung (mehrere Nutzer möglich).
 * null = keine Änderung → kein Log-Eintrag.
 */
export function assigneeActivityDetail(
  addedNames: string[],
  removedNames: string[],
): string | null {
  const parts: string[] = [];
  if (addedNames.length) parts.push(`Zugewiesen: ${addedNames.join(", ")}`);
  if (removedNames.length) parts.push(`Entfernt: ${removedNames.join(", ")}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Schreibt einen Aktivitäts-Eintrag (rein intern, nie öffentlich sichtbar). */
export async function logActivity(
  cardId: number,
  userId: number | null,
  type: ActivityType,
  detail: string,
): Promise<void> {
  await db.insert(cardActivity).values({ cardId, userId, type, detail });
}
