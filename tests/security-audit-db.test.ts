// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { requireMeeting, requireTopic, visibleTopics } from "../lib/meetings/access";
import * as service from "../lib/meetings/service";
import { canAccessBoard, canManageBoard, getAccessibleBoards } from "../lib/authz";
import { canAccessFinanceBoard, canManageFinanceBoard, getAccessibleFinanceBoards, resolveSourceBoards } from "../lib/finance";
import { canAccessInventoryBoard, canManageInventoryBoard, getAccessibleInventoryBoards } from "../lib/inventory";

after(() => pool.end());
const meetingValues = { title: "Audit meeting", startsAt: "2026-11-10T18:00", submissionDeadline: "", location: "", chair: "", state: "planning" };
const topicValues = { title: "Audit TOP", description: "", motion: "", presenter: "", kind: "discussion", durationMinutes: 10, confidential: false, state: "scheduled", outcome: "" };

test("only meeting management can reopen a closed session", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const people = await db.insert(s.users).values(["owner", "writer"].map(name => ({ username: `audit-${name}-${randomUUID()}` }))).returning();
  const [owner, writer] = people;
  const areaId = await service.saveArea(owner, null, "Audit committee", "");
  try {
    await service.saveAreaGrant(owner, areaId, "user", writer.id, "write");
    const values = { ...meetingValues, areaId };
    const meetingId = await service.saveMeeting(owner, null, values);
    await service.saveMeeting(owner, meetingId, { ...values, state: "closed" }, 0);
    const closed = await requireMeeting(owner, meetingId);
    await assert.rejects(service.saveMeeting(writer, meetingId, values, closed.revision), /verwaltung/);
    assert.equal((await requireMeeting(owner, meetingId)).state, "closed");
    await service.saveMeeting(owner, meetingId, values, closed.revision);
    assert.equal((await requireMeeting(owner, meetingId)).state, "planning");
  } finally {
    await db.delete(s.meetings).where(eq(s.meetings.areaId, areaId));
    await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id, areaId));
    await db.delete(s.users).where(inArray(s.users.id, people.map(person => person.id)));
  }
});

test("deleting a confidential parent preserves access protection for its surviving children", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const people = await db.insert(s.users).values(["owner", "reader"].map(name => ({ username: `audit-${name}-${randomUUID()}` }))).returning();
  const [owner, reader] = people;
  const areaId = await service.saveArea(owner, null, "Privacy committee", "");
  try {
    await service.saveAreaGrant(owner, areaId, "user", reader.id, "read");
    const meetingId = await service.saveMeeting(owner, null, { ...meetingValues, areaId });
    const parentId = await service.createTopic(owner, meetingId, { ...topicValues, confidential: true });
    const childId = await service.createTopic(owner, meetingId, { ...topicValues, parentId });
    await service.deleteTopic(owner, parentId);
    const { topic } = await requireTopic(owner, childId);
    assert.equal(topic.parentId, null);
    assert.equal(topic.confidential, true);
    await assert.rejects(requireTopic(reader, childId), /Zugriff/);
    assert.equal((await visibleTopics(reader, meetingId)).length, 0);
  } finally {
    await db.delete(s.meetings).where(eq(s.meetings.areaId, areaId));
    await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id, areaId));
    await db.delete(s.users).where(inArray(s.users.id, people.map(person => person.id)));
  }
});

test("inactive users cannot supply source permissions for shared finances or access owned resources", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const [owner] = await db.insert(s.users).values({ username: `audit-owner-${randomUUID()}` }).returning();
  const [board] = await db.insert(s.boards).values({ name: "Audit source", ownerId: owner.id }).returning();
  const [finance] = await db.insert(s.financeBoards).values({ name: "Audit finance", ownerId: owner.id }).returning();
  const [inventory] = await db.insert(s.inventoryBoards).values({ name: "Audit inventory", ownerId: owner.id }).returning();
  try {
    await db.insert(s.financeBoardSources).values({ financeBoardId: finance.id, boardId: board.id });
    assert.equal((await resolveSourceBoards(finance)).accessible.length, 1);
    const [inactive] = await db.update(s.users).set({ isActive: false }).where(eq(s.users.id, owner.id)).returning();
    for (const actor of [inactive, { ...inactive, role: "admin" as const }]) {
      assert.equal(await canAccessBoard(actor, board), false);
      assert.equal(await canManageBoard(actor, board), false);
      assert.equal(await canAccessFinanceBoard(actor, finance), false);
      assert.equal(await canManageFinanceBoard(actor, finance), false);
      assert.equal(await canAccessInventoryBoard(actor, inventory), false);
      assert.equal(await canManageInventoryBoard(actor, inventory), false);
      assert.deepEqual(await getAccessibleBoards(actor), []);
      assert.deepEqual(await getAccessibleFinanceBoards(actor), []);
      assert.deepEqual(await getAccessibleInventoryBoards(actor), []);
    }
    assert.deepEqual((await resolveSourceBoards(finance)).accessible, []);
  } finally {
    await db.delete(s.financeBoards).where(eq(s.financeBoards.id, finance.id));
    await db.delete(s.inventoryBoards).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.boards).where(eq(s.boards.id, board.id));
    await db.delete(s.users).where(eq(s.users.id, owner.id));
  }
});
