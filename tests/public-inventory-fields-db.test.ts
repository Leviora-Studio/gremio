// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { inventoryBoards, inventoryBoardFields, inventoryItems, inventoryItemCategories, inventoryOptions, users } from "../lib/db/schema";
import { getPublicBoardData } from "../lib/inventory-public";

after(() => pool.end());

test("public inventory payloads omit disabled categories and options belonging only to internal items", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const [owner] = await db.insert(users).values({ username: randomUUID() }).returning();
  const [board] = await db.insert(inventoryBoards).values({ name: "Public field projection", ownerId: owner.id, isPublic: true }).returning();
  try {
    await db.insert(inventoryBoardFields).values({ boardId: board.id, fieldKey: "category", visible: false });
    const [publicCategory, internalCategory] = await db.insert(inventoryOptions).values([
      { boardId: board.id, kind: "category", name: "Optional-public-category" },
      { boardId: board.id, kind: "category", name: "Internal-only-category" },
    ]).returning();
    const [item, internalItem] = await db.insert(inventoryItems).values([
      { boardId: board.id, name: "Public item" },
      { boardId: board.id, name: "Internal item", lendable: false },
    ]).returning();
    await db.insert(inventoryItemCategories).values([
      { itemId: item.id, optionId: publicCategory.id },
      { itemId: internalItem.id, optionId: internalCategory.id },
    ]);
    const hidden = await getPublicBoardData(board.id);
    assert.deepEqual(hidden.publicFields, []);
    assert.equal(hidden.items.length, 1);
    assert.deepEqual(hidden.items[0].categoryIds, []);
    assert.deepEqual(hidden.items[0].categoryNames, []);
    assert.deepEqual(hidden.options.category, []);
    assert.equal(JSON.stringify(hidden).includes(publicCategory.name), false);
    assert.equal(JSON.stringify(hidden).includes(internalCategory.name), false);
    await db.update(inventoryBoardFields).set({ visible: true }).where(eq(inventoryBoardFields.boardId, board.id));
    const shown = await getPublicBoardData(board.id);
    assert.deepEqual(shown.items[0].categoryNames, [publicCategory.name]);
    assert.deepEqual(shown.options.category, [{ id: publicCategory.id, name: publicCategory.name }]);
    assert.equal(JSON.stringify(shown).includes(internalCategory.name), false);
    assert.equal((await db.select().from(inventoryItemCategories).where(eq(inventoryItemCategories.itemId, item.id))).length, 1, "projection preserves stored categories");
  } finally {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, board.id));
    await db.delete(users).where(eq(users.id, owner.id));
  }
});
