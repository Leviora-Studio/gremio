// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { priorities } from "@/lib/db/schema";

export type PriorityOption = { id: number; label: string; color: string };

/** Alle Prioritäts-Optionen in Anzeigereihenfolge. */
export async function getPriorities(): Promise<PriorityOption[]> {
  const rows = await db
    .select()
    .from(priorities)
    .orderBy(asc(priorities.position), asc(priorities.id));
  return rows.map((r) => ({ id: r.id, label: r.label, color: r.color }));
}
