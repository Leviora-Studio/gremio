// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { priorities } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { PRIORITY_COLOR_OPTIONS } from "@/lib/constants";

export type State = { error?: string; success?: string };

const colorValues = PRIORITY_COLOR_OPTIONS.map((o) => o.value) as [
  string,
  ...string[],
];

const schema = z.object({
  label: z.string().min(1, "Bezeichnung erforderlich.").max(40),
  color: z.enum(colorValues),
});

export async function createPriorityAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = schema.safeParse({
    label: formData.get("label"),
    color: formData.get("color"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const [row] = await db.select({ m: max(priorities.position) }).from(priorities);
  await db.insert(priorities).values({
    label: parsed.data.label,
    color: parsed.data.color,
    position: (row?.m ?? -1) + 1,
  });
  revalidatePath("/admin/priorities");
  return { success: `Priorität „${parsed.data.label}" angelegt.` };
}

export async function updatePriorityAction(
  id: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = schema.safeParse({
    label: formData.get("label"),
    color: formData.get("color"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  await db
    .update(priorities)
    .set({ label: parsed.data.label, color: parsed.data.color })
    .where(eq(priorities.id, id));
  revalidatePath("/admin/priorities");
  return { success: "Gespeichert." };
}

export async function deletePriorityAction(id: number): Promise<void> {
  await requireAdmin();
  // cards.priority_id ist ON DELETE SET NULL → Karten bleiben erhalten.
  await db.delete(priorities).where(eq(priorities.id, id));
  revalidatePath("/admin/priorities");
}
