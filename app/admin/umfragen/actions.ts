// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { boardStatuses, feedbackAreas } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { isForeignKeyViolation, isUniqueViolation } from "@/lib/db-errors";
import { sanitizeSingleLine } from "@/lib/text";

/**
 * Verwaltung der Feedback-Bereiche (Admin-Reiter „Umfragen").
 *
 * Fachlich identisch zum Standort-Routing der Anträge
 * (`app/admin/standorte/actions.ts`) — bewusst als eigene, parallele Aktionen,
 * damit die funktionierende Standortverwaltung nicht umgebaut werden muss.
 * JEDE Aktion prüft `requireAdmin()`.
 */
export type State = { error?: string; success?: string };

// sanitizeSingleLine statt nur trim: NUL im Namen ließe sonst den INSERT mit
// einem pg-Fehler (500) scheitern, und Zero-Width-Namen wirkten „nicht leer".
const nameSchema = z.object({
  name: z
    .preprocess(sanitizeSingleLine, z.string())
    .pipe(z.string().min(1, "Name erforderlich.").max(80)),
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
  try {
    await db.insert(feedbackAreas).values({
      name: parsed.data.name,
      enabled: false,
      position: (row?.m ?? -1) + 1,
    });
  } catch (e) {
    // Wie bei den Standorten: Die Prüfung oben sieht einen gleichzeitig
    // angelegten Datensatz noch nicht, der UNIQUE-Index schon.
    if (isUniqueViolation(e)) {
      return { error: "Bereichs-Name bereits vergeben." };
    }
    throw e;
  }
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
  try {
    await db
      .update(feedbackAreas)
      .set({ name: parsed.data.name })
      .where(eq(feedbackAreas.id, areaId));
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { error: "Bereichs-Name bereits vergeben." };
    }
    throw e;
  }
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
  // „Kein Ziel gewählt" (leer) und „ungültiger Wert" (NaN/Nachkommastellen)
  // strikt trennen: `Number("abc")` ist NaN und damit falsy — ein kaputter
  // Wert hätte sonst STILL das Routing entfernt und den Bereich deaktiviert.
  const boardStr = String(formData.get("boardId") ?? "").trim();
  const statusStr = String(formData.get("statusId") ?? "").trim();

  if (!boardStr) {
    // Ohne Ziel gibt es nichts zu routen → Bereich zwangsweise deaktivieren.
    await db
      .update(feedbackAreas)
      .set({ targetBoardId: null, targetStatusId: null, enabled: false })
      .where(eq(feedbackAreas.id, areaId));
    revalidatePath("/admin/umfragen");
    return { success: "Ziel entfernt (Bereich deaktiviert)." };
  }
  const boardId = Number(boardStr);
  if (!Number.isInteger(boardId) || boardId <= 0) {
    return { error: "Ungültiges Ziel-Board." };
  }
  if (!statusStr) {
    return { error: "Bitte auch eine Ziel-Spalte wählen." };
  }
  const statusId = Number(statusStr);
  if (!Number.isInteger(statusId) || statusId <= 0) {
    return { error: "Ungültige Ziel-Spalte." };
  }
  const [status] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)))
    .limit(1);
  if (!status) {
    return { error: "Die Spalte gehört nicht zum gewählten Board." };
  }
  try {
    await db
      .update(feedbackAreas)
      .set({ targetBoardId: boardId, targetStatusId: statusId })
      .where(eq(feedbackAreas.id, areaId));
  } catch (e) {
    // Board/Spalte wurde zwischen Prüfung und UPDATE gelöscht (RESTRICT-FK).
    if (isForeignKeyViolation(e)) {
      return {
        error: "Board oder Spalte wurde zwischenzeitlich gelöscht. Bitte neu wählen.",
      };
    }
    throw e;
  }
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
  // Bedingtes UPDATE (Begründung siehe app/admin/standorte/actions.ts): Sonst
  // ließe sich ein Bereich aktivieren, dem ein zweiter Admin gerade das
  // Routingziel entzogen hat.
  const geaendert = await db
    .update(feedbackAreas)
    .set({ enabled: !area.enabled })
    .where(
      area.enabled
        ? and(eq(feedbackAreas.id, areaId), eq(feedbackAreas.enabled, true))
        : and(
            eq(feedbackAreas.id, areaId),
            eq(feedbackAreas.enabled, false),
            isNotNull(feedbackAreas.targetBoardId),
            isNotNull(feedbackAreas.targetStatusId),
          ),
    )
    .returning({ id: feedbackAreas.id });
  revalidatePath("/admin/umfragen");
  if (!geaendert.length) {
    return {
      error:
        "Der Bereich wurde zwischenzeitlich geändert. Bitte die Seite neu laden.",
    };
  }
  return { success: area.enabled ? "Deaktiviert." : "Aktiviert." };
}
