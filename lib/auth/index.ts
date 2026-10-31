// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { getSession, type SessionData } from "./session";
import { checkSsoSession } from "./sso";

/**
 * Aktuellen Nutzer aus der Session laden (oder null). Pro Request gecacht.
 * Prüft zusätzlich, ob der Account noch aktiv ist.
 */
export async function resolveSessionUser(session: SessionData): Promise<User | null> {
  if (!session.userId) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const user = rows[0];
  if (!user || !user.isActive || (session.sessionVersion ?? 0) !== user.sessionVersion) return null;
  const status = await checkSsoSession(session, user.sub ?? "");
  if (status !== "valid") return null;
  // Recheck local state after network I/O so a concurrent local block cannot be bypassed.
  const [current] = await db.select().from(users).where(eq(users.id,user.id)).limit(1);
  return current?.isActive && current.sessionVersion === user.sessionVersion ? current : null;
}
export const getCurrentUser = cache(async (): Promise<User | null> => resolveSessionUser(await getSession()));

/** Erzwingt eine Anmeldung; leitet sonst auf /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Erzwingt Admin-Rolle; leitet sonst auf /intern (bzw. /login). */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/intern");
  return user;
}

/** Admin ODER Template-Verwalter darf Templates verwalten. */
export function canManageTemplates(user: User): boolean {
  return user.role === "admin" || user.role === "template_manager";
}

/** Erzwingt Template-Verwaltungsrecht (Admin oder Template-Verwalter). */
export async function requireTemplateManager(): Promise<User> {
  const user = await requireUser();
  if (!canManageTemplates(user)) redirect("/intern");
  return user;
}
