// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { groups, userGroups, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

export type State = { error?: string; success?: string };

const groupSchema = z.object({
  name: z.string().min(1, "Name erforderlich.").max(60),
  description: z.string().max(300).optional(),
});

export async function createGroupAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const exists = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.name, parsed.data.name))
    .limit(1);
  if (exists.length) return { error: "Gruppenname bereits vergeben." };

  await db
    .insert(groups)
    .values({ name: parsed.data.name, description: parsed.data.description ?? null });
  revalidatePath("/admin/groups");
  return { success: `Gruppe „${parsed.data.name}" angelegt.` };
}

export async function renameGroupAction(
  groupId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const [clash] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.name, parsed.data.name))
    .limit(1);
  if (clash && clash.id !== groupId) {
    return { error: "Gruppenname bereits vergeben." };
  }
  await db
    .update(groups)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(groups.id, groupId));
  revalidatePath("/admin/groups");
  revalidatePath(`/admin/groups/${groupId}`);
  return { success: "Gespeichert." };
}

export async function deleteGroupAction(groupId: number): Promise<void> {
  await requireAdmin();
  await db.delete(groups).where(eq(groups.id, groupId));
  revalidatePath("/admin/groups");
}

export async function addMemberAction(
  groupId: number,
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return;
  // Nutzer-Existenz prüfen → sauberer No-op statt FK-Fehler/500 bei
  // manipuliertem FormData.
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return;
  await db
    .insert(userGroups)
    .values({ groupId, userId })
    .onConflictDoNothing();
  revalidatePath(`/admin/groups/${groupId}`);
}

export async function removeMemberAction(
  groupId: number,
  userId: number,
): Promise<void> {
  await requireAdmin();
  await db
    .delete(userGroups)
    .where(and(eq(userGroups.groupId, groupId), eq(userGroups.userId, userId)));
  revalidatePath(`/admin/groups/${groupId}`);
}
