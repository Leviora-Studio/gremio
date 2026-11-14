// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { writeBudgetPlan } from "../lib/card-budget-plan-db";
import { projectFinanceTopics } from "../lib/meetings/finance-projection";
after(() => pool.end());

test("budget plans require live write access, reject stale revisions, preserve accounting and filter motion reads", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const [owner, reader, writer, outsider] = await db.insert(s.users).values(["owner", "reader", "writer", "outsider"].map(role => ({ username: `budget-plan-${role}-${randomUUID()}` }))).returning();
  const [board] = await db.insert(s.boards).values({ name: "Planning", ownerId: owner.id, isApplicationBoard: true, legacyFinanceFields:true }).returning();
  const [status] = await db.insert(s.boardStatuses).values({ boardId: board.id, name: "Incoming" }).returning();
  const [account] = await db.insert(s.accounts).values({ name: `Original-${randomUUID()}` }).returning();
  const [card] = await db.insert(s.cards).values({ boardId: board.id, statusId: status.id, title: "Motion", applicant: "Original", token: randomUUID(), budgetTitle: "Legacy", accountId: account.id, requestedAmount: 12345, approvedAmount: 10000, actualAmount: 0 }).returning();
  const topic = { title: "Finance", isFinanceItem: true, financeCardId: card.id, motion: "Bewilligt werden {{planned_budget}}; insgesamt {{planned_budget_total}}." };
  try {
    await db.insert(s.boardAccess).values([{ boardId: board.id, userId: reader.id, accessLevel: "read" }, { boardId: board.id, userId: writer.id, accessLevel: "write" }]);
    const input = [{ amount: "100", budgetTitle: "1200" }, { amount: "250,50", budgetTitle: "1300" }];
    await assert.rejects(writeBudgetPlan(reader, card.id, 0, input), /Schreibzugriff/);
    await assert.rejects(writeBudgetPlan(outsider, card.id, 0, input), /Schreibzugriff/);
    assert.equal(await writeBudgetPlan(writer, card.id, 0, input), 1);
    await assert.rejects(writeBudgetPlan(owner, card.id, 0, []), /zwischenzeitlich/);
    const [after] = await db.select().from(s.cards).where(eq(s.cards.id, card.id));
    const { updatedAt: _beforeDate, ...before } = card;
    const { updatedAt: _afterDate, ...afterValues } = after;
    assert.deepEqual(afterValues, before, "all card and accounting data unchanged");
    assert.equal((await projectFinanceTopics(reader, [topic]))[0].motion, "Bewilligt werden 100,00 € aus Titel 1200 und 250,50 € aus Titel 1300; insgesamt 350,50 €.");
    assert.doesNotMatch((await projectFinanceTopics(outsider, [topic]))[0].motion!, /1200|1300|350/);
    const [saved] = await db.select().from(s.cardBudgetPlans).where(eq(s.cardBudgetPlans.cardId, card.id));
    await assert.rejects(writeBudgetPlan(writer, card.id, 1, [{ amount: "", budgetTitle: "Incomplete" }]), /Betrag/);
    assert.deepEqual((await db.select().from(s.cardBudgetPlans).where(eq(s.cardBudgetPlans.cardId, card.id)))[0], saved);
    const results = await Promise.allSettled([writeBudgetPlan(owner, card.id, 1, input), writeBudgetPlan(writer, card.id, 1, [])]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    await assert.rejects(db.update(s.boards).set({ isApplicationBoard: false }).where(eq(s.boards.id, board.id)));
    const [retained] = await db.select().from(s.cardBudgetPlans).where(eq(s.cardBudgetPlans.cardId, card.id));
    assert.equal(retained.revision, 2);
    await db.delete(s.cards).where(eq(s.cards.id, card.id));
    assert.equal((await db.select().from(s.cardBudgetPlans).where(eq(s.cardBudgetPlans.cardId, card.id))).length, 0);
    assert.doesNotMatch((await projectFinanceTopics(owner, [topic]))[0].motion!, /1200|1300|350/);
  } finally {
    await db.delete(s.boards).where(eq(s.boards.id, board.id));
    await db.delete(s.accounts).where(eq(s.accounts.id, account.id));
    for (const user of [owner, reader, writer, outsider]) await db.delete(s.users).where(eq(s.users.id, user.id));
  }
});
