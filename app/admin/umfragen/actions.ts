// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { boardStatuses, feedbackAreas } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

/**
 * Verwaltung der Feedback-Bereiche (Admin-Reiter „Umfragen").
 *
 * Fachlich identisch zum Standort-Routing der Anträge
 * (`app/admin/standorte/actions.ts`) — bewusst als eigene, parallele Aktionen,
 * damit die funktionierende Standortverwaltung nicht umgebaut werden muss.
 * JEDE Aktion prüft `requireAdmin()`.
 */
export type State = { error?: string; success?: string };

const nameSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(80),
});

export async function createFeedbackAreaAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const exists = await db
    .select({ id: feedbackAreas.id })
    .from(feedbackAreas)
    .where(eq(feedbackAreas.name, parsed.data.name))
    .limit(1);
  if (exists.length) return { error: "Bereichs-Name bereits vergeben." };

  const [row] = await db
    .select({ m: max(feedbackAreas.position) })
    .from(feedbackAreas);
  await db.insert(feedbackAreas).values({
    name: parsed.data.name,
    enabled: false,
    position: (row?.m ?? -1) + 1,
  });
  revalidatePath("/admin/umfragen");
  return { success: `Bereich „${parsed.data.name}" angelegt.` };
}

export async function renameFeedbackAreaAction(
  areaId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const clash = await db
    .select({ id: feedbackAreas.id })
    .from(feedbackAreas)
    .where(eq(feedbackAreas.name, parsed.data.name))
    .limit(1);
  if (clash[0] && clash[0].id !== areaId) {
    return { error: "Bereichs-Name bereits vergeben." };
  }
  // Bereits eingereichtes Feedback behält seinen Bereichsnamen: der Snapshot in
  // feedback_submissions.area_name wird bewusst NICHT mitgeändert.
  await db
    .update(feedbackAreas)
    .set({ name: parsed.data.name })
    .where(eq(feedbackAreas.id, areaId));
  revalidatePath("/admin/umfragen");
  return { success: "Umbenannt." };
}

export async function deleteFeedbackAreaAction(areaId: number): Promise<void> {
  await requireAdmin();
  // feedback_submissions.area_id ist ON DELETE SET NULL → bestehende
  // Feedback-Karten und ihr Herkunfts-Snapshot bleiben erhalten.
  await db.delete(feedbackAreas).where(eq(feedbackAreas.id, areaId));
  revalidatePath("/admin/umfragen");
}

export async function setFeedbackAreaTargetAction(
  areaId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const boardRaw = formData.get("boardId");
  const statusRaw = formData.get("statusId");
  const boardId = boardRaw ? Number(boardRaw) : null;
  const statusId = statusRaw ? Number(statusRaw) : null;

  if (!boardId) {
    // Ohne Ziel gibt es nichts zu routen → Bereich zwangsweise deaktivieren.
    await db
      .update(feedbackAreas)
      .set({ targetBoardId: null, targetStatusId: null, enabled: false })
      .where(eq(feedbackAreas.id, areaId));
    revalidatePath("/admin/umfragen");
    return { success: "Ziel entfernt (Bereich deaktiviert)." };
  }
  if (!statusId) {
    return { error: "Bitte auch eine Ziel-Spalte wählen." };
  }
  const [status] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)))
    .limit(1);
  if (!status) {
    return { error: "Die Spalte gehört nicht zum gewählten Board." };
  }
  await db
    .update(feedbackAreas)
    .set({ targetBoardId: boardId, targetStatusId: statusId })
    .where(eq(feedbackAreas.id, areaId));
  revalidatePath("/admin/umfragen");
  return { success: "Ziel gespeichert." };
}

export async function toggleFeedbackAreaEnabledAction(
  areaId: number,
): Promise<State> {
  await requireAdmin();
  const [area] = await db
    .select()
    .from(feedbackAreas)
    .where(eq(feedbackAreas.id, areaId))
    .limit(1);
  if (!area) return { error: "Bereich nicht gefunden." };
  if (!area.enabled && (!area.targetBoardId || !area.targetStatusId)) {
    return { error: "Erst Ziel-Board und Spalte festlegen, dann aktivieren." };
  }
  await db
    .update(feedbackAreas)
    .set({ enabled: !area.enabled })
    .where(eq(feedbackAreas.id, areaId));
  revalidatePath("/admin/umfragen");
  return { success: area.enabled ? "Deaktiviert." : "Aktiviert." };
}
