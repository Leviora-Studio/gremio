// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userTaskPrefs } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

export type TaskBoardPref = {
  enabled?: boolean;
  excludedStatusIds?: number[];
  fields?: string[];
};
/** Welche Abschnitte auf der Startseite gezeigt werden. */
export type HomePref = { tasks: boolean; boards: boolean; finances: boolean };
export type TaskPrefs = {
  boards?: Record<string, TaskBoardPref>;
  /** Vom Nutzer per Drag&Drop bestimmte Board-Reihenfolge (für „nach Board"). */
  boardOrder?: number[];
  home?: HomePref;
};

function normalizeBoards(
  input: Record<string, TaskBoardPref>,
): Record<string, TaskBoardPref> {
  const out: Record<string, TaskBoardPref> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!v || typeof v !== "object") continue;
    out[k] = {
      enabled: v.enabled !== false,
      excludedStatusIds: Array.isArray(v.excludedStatusIds)
        ? v.excludedStatusIds.filter((n) => Number.isInteger(n)).slice(0, 200)
        : [],
      fields: Array.isArray(v.fields)
        ? v.fields.filter((f) => typeof f === "string").slice(0, 50)
        : [],
    };
  }
  return out;
}

/**
 * Speichert (teilweise) die Aufgaben-/Startseiten-Einstellungen. Nur die
 * übergebenen Top-Level-Schlüssel werden gesetzt — der Rest bleibt erhalten
 * (atomarer JSONB-Merge via `||`), damit Aufgaben- und Startseiten-Settings
 * sich nicht gegenseitig überschreiben.
 */
export async function saveTaskPrefsAction(partial: TaskPrefs): Promise<void> {
  const user = await requireUser();
  const patch: TaskPrefs = {};
  if (partial.boards !== undefined) patch.boards = normalizeBoards(partial.boards);
  if (partial.boardOrder !== undefined) {
    patch.boardOrder = Array.isArray(partial.boardOrder)
      ? partial.boardOrder.filter((n) => Number.isInteger(n)).slice(0, 500)
      : [];
  }
  if (partial.home !== undefined) {
    const h = partial.home;
    patch.home = {
      tasks: h?.tasks !== false,
      boards: h?.boards !== false,
      finances: h?.finances !== false,
    };
  }
  const json = JSON.stringify(patch);

  await db
    .insert(userTaskPrefs)
    .values({ userId: user.id, config: patch })
    .onConflictDoUpdate({
      target: userTaskPrefs.userId,
      set: {
        config: sql`coalesce(${userTaskPrefs.config}, '{}'::jsonb) || ${json}::jsonb`,
      },
    });
}
