// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { fetchPicture, type Claims } from "@/lib/oidc";
import { deleteAvatarFile, processAndSaveAvatar } from "@/lib/avatar";

type Result =
  | { ok: true; userId: number }
  | { ok: false; error: string };

/**
 * Just-in-time-Provisioning: SSO-Identität auf lokales Konto abbilden.
 * Verknüpfung zuerst per stabiler `sub`, sonst per Benutzername (Bestandskonten),
 * sonst neu anlegen. Name & Profilbild werden aus den Claims synchronisiert.
 */
export async function provisionUser(claims: Claims): Promise<Result> {
  const sub = claims.sub;
  const username = (claims.preferred_username || "").trim() || sub;
  const name = (claims.name || "").trim() || username;
  const email = (claims.email || "").trim() || null;

  // 1) per sub
  let [user] = await db.select().from(users).where(eq(users.sub, sub)).limit(1);

  // 2) per Benutzername verknüpfen (Bestandskonto adoptieren)
  if (!user) {
    const [byName] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (byName) {
      if (byName.sub && byName.sub !== sub) {
        // Bestandskonto gehört bereits zu einer ANDEREN SSO-Identität →
        // keine Übernahme (Defense-in-Depth gegen Username-Wiederverwendung).
        return { ok: false, error: "username_conflict" };
      }
      // Atomar adoptieren: nur, wenn sub noch NULL ist (oder bereits unser sub).
      // So kann ein paralleler Callback mit ANDEREM sub das adoptierte sub nicht
      // überschreiben (Compare-and-Swap statt „prüfen, dann per ID schreiben").
      [user] = await db
        .update(users)
        .set({ sub })
        .where(
          and(eq(users.id, byName.id), or(isNull(users.sub), eq(users.sub, sub))),
        )
        .returning();
      // Rennen verloren (anderer Callback hat zuerst adoptiert) → frisch lesen
      // und gegen ein fremdes sub absichern.
      if (!user) {
        [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, byName.id))
          .limit(1);
        if (user?.sub && user.sub !== sub) {
          return { ok: false, error: "username_conflict" };
        }
      }
    }
  }

  // 3) neu anlegen
  if (!user) {
    const role = username === env.ADMIN_USER ? "admin" : "user";
    [user] = await db
      .insert(users)
      .values({ username, sub, name, email, role, isActive: true })
      .onConflictDoNothing()
      .returning();
    // Parallel-Login (z.B. zwei Tabs gleichzeitig): ein zeitgleicher Request hat
    // das Konto bereits angelegt → die Unique-Constraint (sub/username) greift,
    // onConflictDoNothing liefert nichts zurück. Dann erneut lesen statt mit
    // einem 500 zu scheitern.
    if (!user) {
      [user] = await db.select().from(users).where(eq(users.sub, sub)).limit(1);
    }
    if (!user) {
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
    }
    if (!user) return { ok: false, error: "provision_failed" };
  }

  // App-seitiger Kill-Switch
  if (!user.isActive) return { ok: false, error: "inactive" };

  const patch: Partial<typeof users.$inferInsert> = {};
  if (name !== user.name) patch.name = name;
  if (email && email !== user.email) patch.email = email;
  // Admin-Beförderung NUR bei Erst-Anlage (oben beim Insert) — NICHT bei jedem
  // Login. Sonst wäre ein bewusstes Herabstufen des ADMIN_USER wirkungslos
  // (Spec: „wird beim ERSTEN Login automatisch Admin").

  // Profilbild aus dem SSO übernehmen.
  if (claims.picture) {
    const buf = await fetchPicture(claims.picture);
    if (buf) {
      try {
        const rel = await processAndSaveAvatar(user.id, buf);
        if (user.avatarPath) await deleteAvatarFile(user.avatarPath);
        patch.avatarPath = rel;
      } catch {
        /* Bildverarbeitung fehlgeschlagen — ignorieren */
      }
    }
  }

  if (Object.keys(patch).length) {
    await db.update(users).set(patch).where(eq(users.id, user.id));
  }
  return { ok: true, userId: user.id };
}
