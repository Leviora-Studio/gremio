// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import * as service from "../lib/meetings/service";
import { requireMeeting } from "../lib/meetings/access";
import { planFinanceCard } from "../lib/meetings/finance";

after(() => pool.end());

test("area settings serialize with financial planning and meeting edits without lock inversion", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const [owner] = await db.insert(s.users).values({ username: `area-lock-${randomUUID()}` }).returning();
  const [board] = await db.insert(s.boards).values({ name: "Isolated finance board", ownerId: owner.id }).returning();
  const [status] = await db.insert(s.boardStatuses).values({ boardId: board.id, name: "Planned", position: 0 }).returning();
  const [area] = await db.insert(s.meetingAreas).values({ name: "Concurrent settings", ownerId: owner.id, financeBoardId: board.id, financeTargetStatusId: status.id }).returning();
  const values = { areaId: area.id, title: "Concurrent meeting", startsAt: "2026-11-10T18:00", submissionDeadline: "", location: "", chair: "", state: "planning" };
  const mid = await service.saveMeeting(owner, null, values);
  const [root] = await db.insert(s.meetingTopics).values({ meetingId: mid, createdBy: owner.id, title: "Finance", state: "scheduled", isFinanceTopic: true }).returning();
  const [card] = await db.insert(s.cards).values({ boardId: board.id, statusId: status.id, title: "Synthetic card", applicant: "Synthetic applicant", token: randomUUID() }).returning();
  const revision = async () => (await requireMeeting(owner, mid)).revision;
  try {
    for (const change of [
      (rev: number) => planFinanceCard(owner, root.id, card.id, rev),
      (rev: number) => service.saveMeeting(owner, mid, { ...values, title: "Changed title" }, rev),
    ]) {
      const rev = await revision();
      let pending: Promise<unknown> | undefined;
      await db.transaction(async tx => {
        const pid = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        await tx.select().from(s.meetingAreas).where(eq(s.meetingAreas.id, area.id)).for("update");
        // Hold the same first lock as an area-settings save. The competing real
        // service must wait here without already owning the meeting row.
        pending = change(rev).catch(error => error);
        let waiting = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const blocked = await pool.query("select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [pid.rows[0].pid]);
          if (blocked.rowCount) { waiting = true; break; }
          await setTimeout(10);
        }
        assert.ok(waiting, "competing mutation must serialize on the area lock");
        await tx.update(s.meetingAreas).set({ publicNumbering: "roman" }).where(eq(s.meetingAreas.id, area.id));
        await tx.update(s.meetings).set({ revision: sql`${s.meetings.revision}+1` }).where(eq(s.meetings.id, mid));
      });
      const error = await pending;
      assert.ok(error instanceof Error);
      assert.match(error.message, /zwischenzeitlich/, "conflicting saves produce a revision conflict, never a PostgreSQL deadlock");
    }
    assert.equal((await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.parentId, root.id))).length, 0, "failed planning leaves no partial TOP");
    await planFinanceCard(owner, root.id, card.id, await revision());
    assert.equal((await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.parentId, root.id))).length, 1, "retry with the current revision succeeds");
  } finally {
    await service.deleteMeeting(owner, mid);
    await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id, area.id));
    await db.delete(s.boards).where(eq(s.boards.id, board.id));
    await db.delete(s.users).where(eq(s.users.id, owner.id));
  }
});
