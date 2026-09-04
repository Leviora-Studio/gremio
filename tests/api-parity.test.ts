// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { accounts, apiTokens, apiTokenBoards, boards, boardAccess, boardCardFields, boardStatuses, cards, users } from "../lib/db/schema";
import { generateApiToken } from "../lib/api-token";
import { API_FIELD_TO_KEY } from "../lib/board-fields";
import { parseApiId } from "../lib/api";
import { cardWriteSchema } from "../lib/api-cards";
import { GET as discovery } from "../app/api/v1/route";
import { GET as listBoards } from "../app/api/v1/boards/route";
import { GET as getBoard } from "../app/api/v1/boards/[id]/route";
import { GET as listCards, POST as postCard } from "../app/api/v1/boards/[id]/cards/route";
import { GET as getCard, PATCH as patchCard, DELETE as deleteCard } from "../app/api/v1/cards/[id]/route";
import { GET as myCards } from "../app/api/v1/me/cards/route";
import { MAX_AMOUNT_CENTS } from "../lib/money";

after(() => pool.end());

test("API rejects invalid identifiers before PostgreSQL and rejects read-only position payload keys", () => {
  for (const id of ["", "nope", "-1", "0", "1.5", "1e2", "2147483648", "9007199254740993"]) assert.equal(parseApiId(id), null);
  assert.equal(parseApiId("2147483647"), 2147483647);
  for (const key of ["statusId", "accountId", "priorityId", "creatorUserId", "position", "budgetRevision"]) assert.equal(cardWriteSchema.safeParse({ [key]: 2147483648 }).success, false);
  const position = { id: randomUUID(), budgetTitle: null, description: null, accountId: 1 };
  assert.ok(cardWriteSchema.safeParse({ budgetPositions: [position] }).success);
  for (const key of ["cardId", "position"]) assert.equal(cardWriteSchema.safeParse({ budgetPositions: [{ ...position, [key]: 1 }] }).success, false);
});

test("REST handlers preserve app parity: budgets, assignments, triggers, field visibility and live token rights", async (t) => {
  const suffix = `api-parity-${randomUUID()}`;
  const people = await db.insert(users).values(["owner", "member", "outside"].map((name) => ({ username: `${suffix}-${name}` }))).returning();
  const [owner, member, outside] = people;
  const accs = await db.insert(accounts).values(["A", "B"].map((name) => ({ name: `${suffix}-${name}` }))).returning();
  const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning();
  const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
  const token = async (userId: number, scope: "read" | "write" = "write", restricted = false) => {
    const generated = generateApiToken();
    const [saved] = await db.insert(apiTokens).values({ userId, name: suffix, tokenHash: generated.hash, prefix: generated.prefix, scope, restricted }).returning();
    return { value: generated.token, id: saved.id };
  };
  const request = (bearer: string | null, method = "GET", body?: unknown, query = "") => new Request(`http://localhost:3000/api/v1${query}`, {
    method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let cardId = 0;
  try {
    await db.insert(boardAccess).values({ boardId: board.id, userId: member.id });
    await db.insert(boardCardFields).values(Object.values(API_FIELD_TO_KEY).map((fieldKey) => ({ boardId: board.id, fieldKey, visible: true })));
    const statuses = await db.insert(boardStatuses).values([
      { boardId: board.id, name: "Open", position: 0, isReceiptTrigger: true },
      { boardId: board.id, name: "Done", position: 1, isReceiptTrigger: true, isInstructionTrigger: true, isTransferTrigger: true },
    ]).returning();
    await db.update(boards).set({ receiptToStatusId: statuses[1].id, resubmitStatusId: statuses[0].id, doneStatusId: statuses[1].id }).where(eq(boards.id, board.id));
    const manager = await token(owner.id), editor = await token(member.id), read = await token(member.id, "read"), stranger = await token(outside.id), restricted = await token(member.id, "write", true);

    await t.test("discovery, scopes, board restrictions and settings visibility", async () => {
      assert.equal((await discovery(request(null))).status, 401);
      const info = await (await discovery(request(editor.value))).json();
      assert.equal(info.token.scope, "write");
      const listing = await (await listBoards(request(editor.value))).json();
      assert.deepEqual(listing.boards.map((b: { id: number }) => b.id), [board.id]);
      const memberView = await (await getBoard(request(editor.value), params(board.id))).json();
      assert.equal(memberView.board.role, "member");
      for (const key of ["ownerId", "resubmitStatusId", "receiptToStatusId"]) assert.equal(key in memberView.board, false);
      for (const key of ["isInstructionTrigger", "isTransferTrigger", "isReceiptTrigger"]) assert.equal(key in memberView.statuses[0], false);
      const managerView = await (await getBoard(request(manager.value), params(board.id))).json();
      assert.equal(managerView.board.receiptToStatusId, statuses[1].id);
      assert.deepEqual(managerView.statuses.map((s: { isReceiptTrigger: boolean }) => s.isReceiptTrigger), [true, true]);
      assert.equal(managerView.statuses[1].isTransferTrigger, true);
      assert.equal((await getBoard(request(stranger.value), params(board.id))).status, 404);
      assert.equal((await getBoard(request(restricted.value), params(board.id))).status, 404);
      await db.insert(apiTokenBoards).values({ tokenId: restricted.id, boardId: board.id });
      assert.equal((await getBoard(request(restricted.value), params(board.id))).status, 200);
      assert.equal((await postCard(request(read.value, "POST", { title: "Denied" }), params(board.id))).status, 403);
    });

    const rowA = { id: randomUUID(), budgetTitle: "100", description: "First", accountId: accs[0].id, requestedAmount: 20000, approvedAmount: 15000, actualAmount: null };
    const rowB = { id: randomUUID(), budgetTitle: "200", description: null, accountId: accs[1].id, requestedAmount: 30000, approvedAmount: 0, actualAmount: 0 };
    await t.test("POST creates positions atomically and returns matching totals/revision", async () => {
      const response = await postCard(request(editor.value, "POST", { title: suffix, budgetPositions: [rowA, rowB] }), params(board.id));
      assert.equal(response.status, 201);
      const body = await response.json(); cardId = body.card.id;
      assert.equal(body.card.budgetMode, "positions"); assert.equal(body.card.budgetRevision, 1);
      assert.equal(body.card.budgetTitle, null); assert.equal(body.card.accountId, null);
      assert.equal(body.card.requestedAmountCents, 50000); assert.equal(body.card.approvedAmountCents, 15000); assert.equal(body.card.actualAmountCents, 0);
      assert.deepEqual(body.budgetPositions.map((p: { id: string; position: number }) => [p.id, p.position]), [[rowA.id, 0], [rowB.id, 1]]);
      const get = await (await getCard(request(editor.value), params(cardId))).json();
      assert.deepEqual(get.budgetPositions, body.budgetPositions); assert.equal(get.card.budgetRevision, 1);
      assert.equal("token" in get.card, false); assert.equal("nextcloudLink" in get.card, false);
      const before = await db.select().from(cards).where(eq(cards.boardId, board.id));
      for (const payload of [
        { budgetPositions: [rowA, rowB] },
        { budgetPositions: [rowA, { ...rowB, accountId: 2147483647 }] },
        { budgetPositions: [rowA, { ...rowB, requestedAmount: MAX_AMOUNT_CENTS }] },
        { budgetPositions: [rowA, rowA] },
        { budgetPositions: [rowA], approvedAmountCents: 12 },
        { budgetPositions: [rowA], budgetRevision: 1 },
        { budgetRevision: 0 },
      ]) assert.equal((await postCard(request(editor.value, "POST", { title: "Invalid", ...payload }), params(board.id))).status, 400);
      // Fresh IDs exercise validation after insertion rather than the copied-ID guard.
      for (const extra of [{ accountId: 2147483647 }, { requestedAmount: MAX_AMOUNT_CENTS }]) {
        const invalidRows = [{ ...rowA, id: randomUUID() }, { ...rowB, ...extra, id: randomUUID() }];
        assert.equal((await postCard(request(editor.value, "POST", { title: "Invalid", budgetPositions: invalidRows }), params(board.id))).status, 400);
      }
      assert.deepEqual(await db.select().from(cards).where(eq(cards.boardId, board.id)), before, "invalid creates leave no cards or changed positions behind");
    });

    await t.test("assignee-only PATCH sets and clears; members edit all visible card fields", async () => {
      let response = await patchCard(request(editor.value, "PATCH", { assigneeUserIds: [member.id] }), params(cardId));
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).card.assigneeUserIds, [member.id]);
      const assigned = await (await myCards(request(editor.value))).json();
      assert.deepEqual(assigned.cards.map((c: { id: number }) => c.id), [cardId]);
      response = await patchCard(request(editor.value, "PATCH", { assigneeUserIds: [] }), params(cardId));
      assert.deepEqual((await response.json()).card.assigneeUserIds, []);
      assert.deepEqual((await (await myCards(request(editor.value))).json()).cards, []);
      response = await patchCard(request(editor.value, "PATCH", { number: "manual", instructionDate: "2026-09-01", transferDate: "2026-09-02" }), params(cardId));
      assert.equal(response.status, 200); assert.equal((await response.json()).card.number, "manual");
      assert.equal((await patchCard(request(editor.value, "PATCH", { assigneeUserIds: [outside.id] }), params(cardId))).status, 400);
      for (const method of ["PATCH", "DELETE"] as const) {
        const handler = method === "PATCH" ? patchCard : deleteCard;
        assert.equal((await handler(request(read.value, method, method === "PATCH" ? {} : undefined), params(cardId))).status, 403);
      }
    });

    await t.test("hidden fields stay hidden, stale writes are atomic, order and single-mode transitions work", async () => {
      await db.update(boardCardFields).set({ visible: false }).where(eq(boardCardFields.boardId, board.id));
      for (const fieldKey of ["budget_title", "account", "requested_amount"]) await db.insert(boardCardFields).values({ boardId: board.id, fieldKey, visible: true }).onConflictDoUpdate({ target: [boardCardFields.boardId, boardCardFields.fieldKey], set: { visible: true } });
      const visible = await (await getCard(request(editor.value), params(cardId))).json();
      assert.equal("approvedAmountCents" in visible.card, false); assert.equal("approvedAmount" in visible.budgetPositions[0], false);
      assert.equal((await patchCard(request(editor.value, "PATCH", { number: "hidden" }), params(cardId))).status, 400);
      const input = [rowB, rowA].map(({ approvedAmount: _approved, actualAmount: _actual, ...row }) => row);
      const changed = await patchCard(request(editor.value, "PATCH", { budgetPositions: input, budgetRevision: 1 }), params(cardId));
      assert.equal(changed.status, 200); assert.equal((await changed.json()).card.budgetRevision, 2);
      const [saved] = await db.select().from(cards).where(eq(cards.id, cardId)); assert.equal(saved.approvedAmount, 15000);
      assert.equal((await patchCard(request(editor.value, "PATCH", { title: "Must not change", budgetPositions: input, budgetRevision: 1 }), params(cardId))).status, 400);
      assert.equal((await patchCard(request(editor.value, "PATCH", { budgetRevision: 2 }), params(cardId))).status, 400);
      assert.equal((await patchCard(request(editor.value, "PATCH", { approvedAmountCents: 100 }), params(cardId))).status, 400);
      assert.deepEqual((await db.select().from(cards).where(eq(cards.id, cardId)))[0], saved);
      await db.update(boardCardFields).set({ visible: true }).where(eq(boardCardFields.boardId, board.id));
      const single = await patchCard(request(editor.value, "PATCH", { budgetPositions: [rowB], budgetRevision: 2 }), params(cardId));
      assert.equal(single.status, 200); const singleBody = await single.json();
      assert.equal(singleBody.card.budgetMode, "single"); assert.equal(singleBody.card.accountId, accs[1].id); assert.deepEqual(singleBody.budgetPositions, []);
    });

    await t.test("moves run both date triggers, reset resubmission and start the done timer", async () => {
      await db.update(cards).set({ instructionDate: null, transferDate: null, resubmittedAt: new Date() }).where(eq(cards.id, cardId));
      const moved = await patchCard(request(editor.value, "PATCH", { statusId: statuses[1].id }), params(cardId));
      assert.equal(moved.status, 200);
      const [saved] = await db.select().from(cards).where(eq(cards.id, cardId));
      assert.ok(saved.instructionDate); assert.ok(saved.transferDate); assert.ok(saved.doneSince); assert.equal(saved.resubmittedAt, null);
    });

    await t.test("invalid paths/filters return JSON errors; revocation and deletion apply immediately", async () => {
      for (const id of ["bad", "0", "2147483648"]) {
        assert.equal((await getBoard(request(editor.value), params(id))).status, 404);
        assert.equal((await getCard(request(editor.value), params(id))).status, 404);
      }
      for (const query of ["?statusId=bad", "?statusId=2147483648", "?archived=invalid"]) assert.equal((await listCards(request(editor.value, "GET", undefined, query), params(board.id))).status, 400);
      assert.equal((await myCards(request(editor.value, "GET", undefined, "?archived=bad"))).status, 400);
      assert.equal((await listCards(request(editor.value), params(board.id))).status, 200);
      await db.delete(apiTokens).where(eq(apiTokens.id, restricted.id));
      assert.equal((await getCard(request(restricted.value), params(cardId))).status, 401);
      await db.delete(boardAccess).where(eq(boardAccess.boardId, board.id));
      assert.equal((await getCard(request(editor.value), params(cardId))).status, 404);
      assert.equal((await deleteCard(request(manager.value, "DELETE"), params(cardId))).status, 200);
      assert.equal((await getCard(request(manager.value), params(cardId))).status, 404);
    });
  } finally {
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(accounts).where(inArray(accounts.id, accs.map((a) => a.id)));
    await db.delete(users).where(inArray(users.id, people.map((p) => p.id)));
  }
});
