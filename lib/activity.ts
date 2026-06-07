// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { db } from "@/lib/db";
import { cardActivity } from "@/lib/db/schema";

export type ActivityType =
  | "created"
  | "status"
  | "assignee"
  | "attachment_added"
  | "attachment_removed"
  | "archive"
  | "archive_failed";

/** Schreibt einen Aktivitäts-Eintrag (rein intern, nie öffentlich sichtbar). */
export async function logActivity(
  cardId: number,
  userId: number | null,
  type: ActivityType,
  detail: string,
): Promise<void> {
  await db.insert(cardActivity).values({ cardId, userId, type, detail });
}
