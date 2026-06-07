// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { boardStatuses, locations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

export type State = { error?: string; success?: string };

const nameSchema = z.object({
  name: z.string().min(1, "Name erforderlich.").max(80),
});

export async function createLocationAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const exists = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.name, parsed.data.name))
    .limit(1);
  if (exists.length) return { error: "Standort-Name bereits vergeben." };

  const [row] = await db.select({ m: max(locations.position) }).from(locations);
  await db.insert(locations).values({
    name: parsed.data.name,
    enabled: false,
    position: (row?.m ?? -1) + 1,
  });
  revalidatePath("/admin/standorte");
  return { success: `Standort „${parsed.data.name}" angelegt.` };
}

export async function renameLocationAction(
  locationId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const clash = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.name, parsed.data.name))
    .limit(1);
  if (clash[0] && clash[0].id !== locationId) {
    return { error: "Standort-Name bereits vergeben." };
  }
  await db
    .update(locations)
    .set({ name: parsed.data.name })
    .where(eq(locations.id, locationId));
  revalidatePath("/admin/standorte");
  return { success: "Umbenannt." };
}

export async function deleteLocationAction(locationId: number): Promise<void> {
  await requireAdmin();
  // cards.location_id ist ON DELETE SET NULL → bestehende Karten bleiben erhalten.
  await db.delete(locations).where(eq(locations.id, locationId));
  revalidatePath("/admin/standorte");
}

export async function setLocationTargetAction(
  locationId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const boardRaw = formData.get("boardId");
  const statusRaw = formData.get("statusId");
  const boardId = boardRaw ? Number(boardRaw) : null;
  const statusId = statusRaw ? Number(statusRaw) : null;

  if (!boardId) {
    await db
      .update(locations)
      .set({ targetBoardId: null, targetStatusId: null, enabled: false })
      .where(eq(locations.id, locationId));
    revalidatePath("/admin/standorte");
    return { success: "Ziel entfernt (Standort deaktiviert)." };
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
    .update(locations)
    .set({ targetBoardId: boardId, targetStatusId: statusId })
    .where(eq(locations.id, locationId));
  revalidatePath("/admin/standorte");
  return { success: "Ziel gespeichert." };
}

export async function toggleLocationEnabledAction(
  locationId: number,
): Promise<State> {
  await requireAdmin();
  const [loc] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!loc) return { error: "Standort nicht gefunden." };
  if (!loc.enabled && (!loc.targetBoardId || !loc.targetStatusId)) {
    return { error: "Erst Ziel-Board und Spalte festlegen, dann aktivieren." };
  }
  await db
    .update(locations)
    .set({ enabled: !loc.enabled })
    .where(eq(locations.id, locationId));
  revalidatePath("/admin/standorte");
  return { success: loc.enabled ? "Deaktiviert." : "Aktiviert." };
}
