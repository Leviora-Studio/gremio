// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { boardStatuses, locations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";

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
  try {
    await db.insert(locations).values({
      name: parsed.data.name,
      enabled: false,
      position: (row?.m ?? -1) + 1,
    });
  } catch (e) {
    // Zwei Admins legen gleichzeitig denselben Namen an: Die Prüfung oben sieht
    // den anderen Datensatz noch nicht, der UNIQUE-Index schlägt zu. Vorher war
    // das ein 500er statt einer verständlichen Meldung.
    if (isUniqueViolation(e)) {
      return { error: "Standort-Name bereits vergeben." };
    }
    throw e;
  }
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
  try {
    await db
      .update(locations)
      .set({ name: parsed.data.name })
      .where(eq(locations.id, locationId));
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { error: "Standort-Name bereits vergeben." };
    }
    throw e;
  }
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
  // Bedingtes UPDATE statt „gelesenen Stand zurückschreiben": Zwischen dem
  // SELECT oben und dem UPDATE kann ein zweiter Admin das Ziel entfernt (und
  // damit deaktiviert) haben — der Standort wäre danach aktiviert OHNE
  // Routingziel. `enabled` wird deshalb zusätzlich als Compare-and-Swap
  // geprüft, und beim Aktivieren muss das Ziel in derselben Anweisung noch
  // gesetzt sein.
  const geaendert = await db
    .update(locations)
    .set({ enabled: !loc.enabled })
    .where(
      loc.enabled
        ? and(eq(locations.id, locationId), eq(locations.enabled, true))
        : and(
            eq(locations.id, locationId),
            eq(locations.enabled, false),
            isNotNull(locations.targetBoardId),
            isNotNull(locations.targetStatusId),
          ),
    )
    .returning({ id: locations.id });
  revalidatePath("/admin/standorte");
  if (!geaendert.length) {
    return {
      error:
        "Der Standort wurde zwischenzeitlich geändert. Bitte die Seite neu laden.",
    };
  }
  return { success: loc.enabled ? "Deaktiviert." : "Aktiviert." };
}
