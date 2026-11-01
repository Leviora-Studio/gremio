// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

export type State = { error?: string; success?: string };

export async function setRoleAction(
  userId: number,
  role: "admin" | "template_manager" | "user",
): Promise<void> {
  const me = await requireAdmin();
  if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647 || !["admin", "template_manager", "user"].includes(role)) return;
  // Sich selbst nie die Admin-Rechte entziehen.
  if (role !== "admin" && userId === me.id) return;

  await db.transaction(async (tx) => {
    // Aktive Admins per FOR UPDATE sperren → parallele Degradierungen werden
    // serialisiert (verhindert den TOCTOU-Race „0 Admins übrig").
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
      .orderBy(users.id)
      .for("update");

    // Authentication can precede a concurrent role revocation or local block.
    // Recheck after the same locks used by setUserActiveAction are acquired.
    const [actor] = await tx.select().from(users).where(eq(users.id, me.id)).for("update");
    if (!actor?.isActive || actor.role !== "admin") return;

    const demotingAdmin = role !== "admin" && admins.some((a) => a.id === userId);
    if (demotingAdmin && admins.filter((a) => a.id !== userId).length < 1) {
      return; // letzter Admin bleibt Admin
    }
    await tx.update(users).set({ role }).where(eq(users.id, userId));
  });
  revalidatePath("/admin/users");
}


/** Local access switch; never changes the upstream SSO account. */
export async function setUserActiveAction(userId: number, active: boolean): Promise<State> {
  const me = await requireAdmin();
  if (!Number.isSafeInteger(userId) || userId < 1 || typeof active !== "boolean") return {error:"Ungültiger Nutzer."};
  if (!active && me.id === userId) return {error:"Du kannst dein eigenes Konto nicht deaktivieren."};
  const result = await db.transaction(async tx => {
    const admins = await tx.select({id:users.id}).from(users).where(and(eq(users.role,"admin"),eq(users.isActive,true))).orderBy(users.id).for("update");
    const [actor] = await tx.select().from(users).where(eq(users.id,me.id)).for("update");
    if (!actor?.isActive || actor.role !== "admin") return {error:"Keine aktiven Admin-Rechte."};
    const [target] = await tx.select().from(users).where(eq(users.id,userId)).for("update");
    if (!target) return {error:"Nutzer nicht gefunden."};
    if (!active && target.isActive && target.role === "admin" && admins.filter(u=>u.id!==userId).length===0) return {error:"Der letzte aktive Admin kann nicht deaktiviert werden."};
    if (target.isActive !== active) await tx.update(users).set({isActive:active,sessionVersion:sql`${users.sessionVersion} + 1`}).where(eq(users.id,userId));
    return {success:active?"Nutzer reaktiviert. Eine neue Anmeldung ist erforderlich.":"Nutzer deaktiviert."};
  });
  revalidatePath("/admin/users");
  return result;
}
