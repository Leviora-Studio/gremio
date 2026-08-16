// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

export type State = { error?: string; success?: string };

export async function setRoleAction(
  userId: number,
  role: "admin" | "template_manager" | "user",
): Promise<void> {
  const me = await requireAdmin();
  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return;
  // Sich selbst nie die Admin-Rechte entziehen.
  if (target.role === "admin" && role !== "admin" && target.id === me.id) return;

  await db.transaction(async (tx) => {
    // Aktive Admins per FOR UPDATE sperren → parallele Degradierungen werden
    // serialisiert (verhindert den TOCTOU-Race „0 Admins übrig").
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
      .for("update");

    const demotingAdmin = role !== "admin" && admins.some((a) => a.id === userId);
    if (demotingAdmin && admins.filter((a) => a.id !== userId).length < 1) {
      return; // letzter Admin bleibt Admin
    }
    await tx.update(users).set({ role }).where(eq(users.id, userId));
  });
  revalidatePath("/admin/users");
}
