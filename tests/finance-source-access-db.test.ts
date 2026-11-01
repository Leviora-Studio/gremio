// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { canAccessBoard, getAccessibleBoards } from "../lib/authz";
import { resolveSourceBoards } from "../lib/finance";
import { changeOwnership } from "../lib/board-ownership";

after(() => pool.end());

test("finance sources and board lists inherit live inventory permissions exclusively", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const people = await db.insert(s.users).values(["owner", "coowner", "reader", "stale"].map(name => ({ username: `${name}-${randomUUID()}` }))).returning();
  const [owner, coowner, reader, stale] = people;
  const [inventory] = await db.insert(s.inventoryBoards).values({ name: "Source inventory", ownerId: owner.id }).returning();
  const [board] = await db.insert(s.boards).values({ name: "Source loans", ownerId: owner.id, inventoryBoardId: inventory.id }).returning();
  await db.update(s.inventoryBoards).set({ loanBoardId: board.id }).where(eq(s.inventoryBoards.id, inventory.id));
  const finances = await db.insert(s.financeBoards).values(people.map(person => ({ name: `Finance ${person.id}`, ownerId: person.id }))).returning();
  try {
    await changeOwnership(owner, "inventory", inventory.id, coowner.id, "add", "ERNENNEN");
    await db.insert(s.inventoryBoardAccess).values({ boardId: inventory.id, userId: reader.id, accessLevel: "read" });
    // Old/imported grants on a system board must not override its inventory.
    await db.insert(s.boardAccess).values({ boardId: board.id, userId: stale.id, accessLevel: "write" });
    await db.insert(s.boardOwners).values({ boardId: board.id, userId: stale.id });
    await db.insert(s.financeBoardSources).values(finances.map(finance => ({ financeBoardId: finance.id, boardId: board.id })));
    for (const person of [owner, coowner, reader]) {
      assert.equal(await canAccessBoard(person, board), true);
      const finance = finances.find(row => row.ownerId === person.id)!;
      assert.deepEqual((await resolveSourceBoards(finance)).accessible.map(row => row.id), [board.id]);
      assert.ok((await getAccessibleBoards(person)).some(row => row.id === board.id));
    }
    assert.equal(await canAccessBoard(stale, board), false);
    assert.equal((await getAccessibleBoards(stale)).some(row => row.id === board.id), false);
    assert.deepEqual((await resolveSourceBoards(finances.find(row => row.ownerId === stale.id)!)).accessible, []);
    await db.delete(s.inventoryBoardAccess).where(eq(s.inventoryBoardAccess.userId, reader.id));
    assert.deepEqual((await resolveSourceBoards(finances.find(row => row.ownerId === reader.id)!)).accessible, []);
  } finally {
    await db.delete(s.financeBoards).where(inArray(s.financeBoards.id, finances.map(row => row.id)));
    await db.update(s.inventoryBoards).set({ loanBoardId: null }).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.boards).where(eq(s.boards.id, board.id));
    await db.delete(s.inventoryBoards).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.users).where(inArray(s.users.id, people.map(row => row.id)));
  }
});
