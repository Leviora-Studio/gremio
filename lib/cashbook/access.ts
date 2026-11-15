// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cashbooks, cashbookAccess, cashbookEntries, userGroups, users, type User } from "@/lib/db/schema";
import { getUserGroupIds } from "@/lib/authz";
export type Cashbook = typeof cashbooks.$inferSelect;
export async function cashbookPermission(user: User, book: Cashbook): Promise<"manage" | "write" | "read" | "office" | null> {
    if (!user.isActive || book.deletedAt)
        return null;
    if (book.ownerId === user.id)
        return "manage";
    const groupIds = await getUserGroupIds(user.id), grants = await db.select().from(cashbookAccess).where(trashAnd(activeRows.cashbookAccess, eq(cashbookAccess.cashbookId, book.id)));
    const matching = grants.filter(g => g.userId === user.id || g.groupId != null && groupIds.includes(g.groupId));
    if (matching.some(g => g.accessLevel === "write"))
        return "write";
    if (matching.length)
        return "read";
    if (book.config.officeId === user.id)
        return "office";
    return null;
}
export async function requireCashbook(user: User, id: number, level: "read" | "write" | "manage" = "read") {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647)
        throw new Error("Kassenbuch nicht verfügbar.");
    const [book] = await db.select().from(cashbooks).where(trashAnd(activeRows.cashbooks, eq(cashbooks.id, id)));
    if (!book)
        throw new Error("Kassenbuch nicht verfügbar.");
    const permission = await cashbookPermission(user, book);
    if (!permission || level === "manage" && permission !== "manage" && user.role !== "admin" || level === "write" && !["manage", "write"].includes(permission))
        throw new Error("Sie haben nicht die nötigen Rechte für dieses Kassenbuch.");
    return { book, permission };
}
export async function accessibleCashbooks(user: User) { const result = []; for (const book of await db.select().from(cashbooks).where(activeRows.cashbooks)) {
    const permission = await cashbookPermission(user, book);
    if (permission)
        result.push({ ...book, permission });
} return result; }
export async function cashbookWriters(book: Cashbook) {
    const grants = await db.select().from(cashbookAccess).where(trashAnd(activeRows.cashbookAccess, and(eq(cashbookAccess.cashbookId, book.id), eq(cashbookAccess.accessLevel, "write"))));
    const groupIds = grants.flatMap(g => g.groupId ? [g.groupId] : []);
    const memberships = groupIds.length ? await db.select({ userId: userGroups.userId }).from(userGroups).where(trashAnd(activeRows.userGroups, inArray(userGroups.groupId, groupIds))) : [];
    const ids = [book.ownerId, ...grants.flatMap(g => g.userId ? [g.userId] : []), ...memberships.map(m => m.userId)];
    return db.select().from(users).where(and(eq(users.isActive, true), inArray(users.id, ids)));
}
export async function requireCashbookEntry(user: User, id: number) { const [entry] = Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? await db.select().from(cashbookEntries).where(trashAnd(activeRows.cashbookEntries, eq(cashbookEntries.id, id))) : []; if (!entry)
    throw new Error("Vorgang nicht verfügbar."); const access = await requireCashbook(user, entry.cashbookId); if (access.permission === "office" && entry.state !== "posted")
    throw new Error("Sie haben nicht die nötigen Rechte für diesen Vorgang."); return { ...access, entry }; }
