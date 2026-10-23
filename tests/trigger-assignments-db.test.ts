// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  boardAccess, boardCardFields, boards, boardStatuses, boardTriggerAssignments,
  cardActivity, cardAssignees, cards, users,
} from "../lib/db/schema";
import {
  applyStatusTriggerAssignments, applyTriggerAssignments, getTriggerAssignmentConfigs,
  planTriggerAssignment, setTriggerAssignmentConfig, statusTriggerKinds,
} from "../lib/trigger-assignments";

after(() => pool.end());

test("trigger assignment plan clears first, then adds only board members", () => {
  const members = new Set([1, 2, 3]);
  assert.deepEqual(planTriggerAssignment([1, 2], { clearAssignees: true, userIds: [] }, members), { added: [], removed: [1, 2] });
  assert.deepEqual(planTriggerAssignment([1], { clearAssignees: false, userIds: [1, 3, 9] }, members), { added: [3], removed: [] });
  assert.deepEqual(planTriggerAssignment([1, 2], { clearAssignees: true, userIds: [2, 3] }, members), { added: [3], removed: [1] });
  assert.deepEqual(planTriggerAssignment([], { clearAssignees: false, userIds: [] }, members), { added: [], removed: [] });
});

test("board triggers clear and add assignees, log the change and respect hidden fields", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/, "isolated test database required");
  const suffix = `trigger-assign-${randomUUID()}`;
  const created = await db.insert(users).values(["owner", "a", "b", "outsider"].map((n) => ({ username: `${suffix}-${n}`, role: "user" as const }))).returning();
  const [owner, a, b, outsider] = created;
  const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning();
  try {
    await db.insert(boardAccess).values([{ boardId: board.id, userId: a.id }, { boardId: board.id, userId: b.id }]);
    const [open, instr, done] = await db.insert(boardStatuses).values([
      { boardId: board.id, name: "Open", position: 0 },
      { boardId: board.id, name: "Instr", position: 1, isInstructionTrigger: true, isArchiveTrigger: true },
      { boardId: board.id, name: "Done", position: 2 },
    ]).returning();
    await db.update(boards).set({ doneStatusId: done.id, doneSweepTime: "03:00" }).where(eq(boards.id, board.id));
    await db.insert(boardCardFields).values({ boardId: board.id, fieldKey: "assignee", visible: true });
    const [card] = await db.insert(cards).values({ boardId: board.id, statusId: open.id, title: suffix, applicant: "Test", token: suffix }).returning();
    await db.insert(cardAssignees).values({ cardId: card.id, userId: a.id });

    assert.deepEqual(await statusTriggerKinds(instr.id), ["instruction", "archive"]);
    assert.deepEqual(await statusTriggerKinds(done.id), ["done"]);
    assert.match((await setTriggerAssignmentConfig(board.id, "instruction", false, [outsider.id])).error ?? "", /Zugriff/);
    assert.equal((await setTriggerAssignmentConfig(board.id, "instruction", true, [b.id])).success, "Zuweisungen gespeichert.");
    assert.equal((await setTriggerAssignmentConfig(board.id, "done", true, [])).success, "Zuweisungen gespeichert.");
    assert.deepEqual(await getTriggerAssignmentConfigs(board.id), new Map([
      ["instruction", { clearAssignees: true, userIds: [b.id] }],
      ["done", { clearAssignees: true, userIds: [] }],
    ]));

    const assigned = async () => (await db.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id))).map((r) => r.userId).sort();
    const log = async () => (await db.select().from(cardActivity).where(eq(cardActivity.cardId, card.id)).orderBy(asc(cardActivity.id))).map((r) => [r.type, r.userId, r.detail]);

    await applyStatusTriggerAssignments(card.id, instr.id);
    assert.deepEqual(await assigned(), [b.id]);
    assert.deepEqual(await log(), [["assignee", null, `Automatisch (Trigger „Anweisungsdatum"): Zugewiesen: ${b.username} · Entfernt: ${a.username}`]]);

    await applyStatusTriggerAssignments(card.id, instr.id);
    assert.equal((await log()).length, 1, "no-op runs are not logged");

    // Hidden "Zugewiesen zu" field: triggers must not write it.
    await db.update(boardCardFields).set({ visible: false }).where(eq(boardCardFields.boardId, board.id));
    await applyStatusTriggerAssignments(card.id, done.id);
    assert.deepEqual(await assigned(), [b.id]);
    await db.update(boardCardFields).set({ visible: true }).where(eq(boardCardFields.boardId, board.id));
    await applyStatusTriggerAssignments(card.id, done.id);
    assert.deepEqual(await assigned(), []);
    assert.equal((await log()).at(-1)?.[2], `Automatisch (Trigger „Done-Spalte"): Entfernt: ${b.username}`);

    // Event triggers without a column (resubmission) and members who lost access.
    await setTriggerAssignmentConfig(board.id, "resubmit", false, [a.id, b.id]);
    await db.delete(boardAccess).where(eq(boardAccess.userId, b.id));
    await applyTriggerAssignments(card.id, ["resubmit"]);
    assert.deepEqual(await assigned(), [a.id]);

    // Empty configuration removes the row entirely.
    await setTriggerAssignmentConfig(board.id, "resubmit", false, []);
    assert.equal((await db.select().from(boardTriggerAssignments).where(eq(boardTriggerAssignments.boardId, board.id))).some((r) => r.trigger === "resubmit"), false);
  } finally {
    await db.delete(cards).where(eq(cards.boardId, board.id));
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(users).where(inArray(users.id, created.map((u) => u.id)));
  }
});
