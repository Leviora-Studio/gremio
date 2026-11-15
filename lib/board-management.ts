// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq, sql, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardAccess, boardManagers, boardOwners, boards, inventoryBoardAccess, inventoryBoardManagers, inventoryBoardOwners, inventoryBoards, meetingAreas, meetingAreaAccess, meetingAreaManagers, users, type User } from "@/lib/db/schema";

export class BoardManagementError extends Error {}

type ManagementKind = "board" | "inventory" | "meeting_area";
const resources = { board: boards, inventory: inventoryBoards, meeting_area: meetingAreas };
const memberships = { board: boardManagers, inventory: inventoryBoardManagers, meeting_area: meetingAreaManagers };
const ownerships = { board: boardOwners, inventory: inventoryBoardOwners };
const accesses = { board: boardAccess, inventory: inventoryBoardAccess, meeting_area: meetingAreaAccess };
const membershipId = (kind: ManagementKind) => kind === "meeting_area" ? meetingAreaManagers.areaId : memberships[kind].boardId;
const systemBoard = (kind: ManagementKind) => kind === "board" ? sql<boolean>`${boards.inventoryBoardId} is not null` : sql<boolean>`false`;

// Effective direct/group write grants; a read grant never cancels a write grant.
const hasWriteGrant = (kind: ManagementKind, boardId: number) => sql<boolean>`exists (
  select 1 from ${accesses[kind]} a
  where a.${sql.identifier(kind === "meeting_area" ? "area_id" : "board_id")} = ${boardId} and a.access_level = 'write'
    and (a.user_id = ${users.id} or exists (
      select 1 from user_groups g where g.user_id = ${users.id} and g.group_id = a.group_id and exists(select 1 from groups trash_group where trash_group.id=g.group_id and trash_group.deleted_at is null)
    ))
)`;

async function getManagementPeople(kind: ManagementKind, boardId: number) {
  const resource = resources[kind], managersTable = memberships[kind], ownersTable = kind === "meeting_area" ? null : ownerships[kind];
  const [board] = await db.select({ ownerId: resource.ownerId, system: systemBoard(kind) }).from(resource).where(and(eq(resource.id, boardId),isNull(resource.deletedAt)));
  if (!board || board.system) return { candidates: [], managers: [] };
  const candidates = await db.select({ id: users.id, username: users.username, name: users.name }).from(users)
    .where(and(eq(users.isActive, true), sql`${users.role} <> 'admin'`, sql`${users.id} <> ${board.ownerId}`,
      ownersTable ? sql`not exists (select 1 from ${ownersTable} o where o.board_id = ${boardId} and o.user_id = ${users.id})` : undefined, hasWriteGrant(kind, boardId)))
    .orderBy(users.username);
  const managers = await db.select({ id: users.id, username: users.username, name: users.name,
    active: sql<boolean>`${users.isActive} and (${hasWriteGrant(kind, boardId)} or ${users.role} = 'admin' or ${users.id} = ${board.ownerId}
      or ${ownersTable ? sql`exists (select 1 from ${ownersTable} o where o.board_id = ${boardId} and o.user_id = ${users.id})` : sql`false`})` })
    .from(managersTable).innerJoin(users, eq(users.id, managersTable.userId))
    .where(eq(membershipId(kind), boardId)).orderBy(users.username);
  return { candidates, managers };
}

/** Only full owners/admins can appoint delegates; never a delegated manager. */
async function setManager(actor: User, kind: ManagementKind, boardId: number, userId: number, enabled: boolean) {
  const resource = resources[kind], managersTable = memberships[kind], ownersTable = kind === "meeting_area" ? null : ownerships[kind];
  if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) throw new BoardManagementError("Bitte eine gültige Person auswählen.");
  await db.transaction(async tx => {
    const [board] = await tx.select({ ownerId: resource.ownerId, system: systemBoard(kind) }).from(resource).where(and(eq(resource.id, boardId),isNull(resource.deletedAt))).for("update");
    const [liveActor] = await tx.select().from(users).where(eq(users.id, actor.id)).for("share");
    const [owner] = ownersTable ? await tx.select().from(ownersTable).where(and(eq(ownersTable.boardId, boardId), eq(ownersTable.userId, actor.id))) : [];
    if (!board || board.system || !liveActor?.isActive ||
      (liveActor.role !== "admin" && board.ownerId !== actor.id && !owner)) {
      throw new BoardManagementError("Nur Eigentümer und Admins dürfen Verwaltungsrechte vergeben oder entziehen.");
    }
    if (!enabled) {
      await tx.delete(managersTable).where(and(eq(membershipId(kind), boardId), eq(managersTable.userId, userId)));
      return;
    }
    const [target] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.isActive, true), hasWriteGrant(kind, boardId))).for("share");
    if (!target) throw new BoardManagementError(`Die Person benötigt bereits schreibenden Zugriff auf ${kind === "meeting_area" ? "diesen Sitzungsbereich" : kind === "inventory" ? "dieses Inventar" : "dieses Board"}.`);
    const [targetOwner] = ownersTable ? await tx.select().from(ownersTable).where(and(eq(ownersTable.boardId, boardId), eq(ownersTable.userId, userId))) : [];
    if (target.role === "admin" || board.ownerId === userId || targetOwner) throw new BoardManagementError("Diese Person hat bereits vollständige Verwaltungsrechte.");
    if (kind === "meeting_area") await tx.insert(meetingAreaManagers).values({ areaId: boardId, userId, grantedById: actor.id }).onConflictDoNothing();
    else await tx.insert(memberships[kind]).values({ boardId, userId, grantedById: actor.id }).onConflictDoNothing();
  });
}

export function getBoardManagementPeople(boardId: number) { return getManagementPeople("board", boardId); }
export function getInventoryManagementPeople(boardId: number) { return getManagementPeople("inventory", boardId); }
export function setBoardManager(actor: User, boardId: number, userId: number, enabled: boolean) { return setManager(actor, "board", boardId, userId, enabled); }
export function setInventoryManager(actor: User, boardId: number, userId: number, enabled: boolean) { return setManager(actor, "inventory", boardId, userId, enabled); }
export function getMeetingAreaManagementPeople(areaId: number) { return getManagementPeople("meeting_area", areaId); }
export function setMeetingAreaManager(actor: User, areaId: number, userId: number, enabled: boolean) { return setManager(actor, "meeting_area", areaId, userId, enabled); }
