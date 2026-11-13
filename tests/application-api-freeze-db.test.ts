// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { generateApiToken } from "../lib/api-token";
import { PATCH, DELETE, GET } from "../app/api/v1/cards/[id]/route";
import { lockCardApi, budgetPlanApi } from "../lib/api-application-cards";
import { commentsApi, attachmentsApi } from "../lib/api-card-extras";
import { callMcpTool, mcpTools } from "../lib/mcp-tools";
import type { McpContext } from "../lib/mcp-oauth";
import { getApplicationStatusByToken } from "../lib/public-status";
import { insertPublicAttachment, submitPublicWorkflow } from "../lib/public-workflow";
import { GET as cashbookFile } from "../app/api/cashbook/[id]/file/route";
import { GET as cashbookZip } from "../app/api/cashbook/[id]/zip/route";
import { openApiV1Spec } from "../lib/openapi-v1";
import { openApiPublicSpec } from "../lib/openapi-public";

after(() => pool.end());
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
test("REST and MCP honor irreversible freezes, application scopes and public status without exposing cashbooks", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(env.UPLOAD_DIR, /^\/(private\/)?tmp\/gremio-cashbook-test-/);
  const tag = randomUUID();
  const [owner, writer, reader, outsider] = await db.insert(s.users).values(["owner", "writer", "reader", "outside"].map(name => ({ username: `${tag}-${name}` }))).returning();
  const [board, other] = await db.insert(s.boards).values([{ name: tag, ownerId: owner.id, isApplicationBoard: true }, { name: tag, ownerId: owner.id }]).returning();
  const [incoming, accepted, archived] = await db.insert(s.boardStatuses).values([{ boardId: board.id, name: "Incoming" }, { boardId: board.id, name: "Accepted", isLockColumn: true, isReceiptTrigger: true }, { boardId: board.id, name: "Archive", isArchiveTrigger: true }]).returning();
  await db.insert(s.boardAccess).values([{ boardId: board.id, userId: writer.id, accessLevel: "write" }, { boardId: board.id, userId: reader.id, accessLevel: "read" }]);
  await db.insert(s.boardCardFields).values(["notes", "number", "assignee", "finance_request", "other_pdfs", "account", "budget_title", "approved_amount"].map(fieldKey => ({ boardId: board.id, fieldKey, visible: true })));
  const [account] = await db.insert(s.accounts).values({ name: tag }).returning();
  const [card, pending] = await db.insert(s.cards).values([{ boardId: board.id, statusId: incoming.id, title: "Frozen application", applicant: "Synthetic", token: randomUUID(), number: "AN-0001", accountId: account.id, approvedAmount: 10000 }, { boardId: board.id, statusId: accepted.id, title: "Initially pending", applicant: "Synthetic", token: randomUUID() }]).returning();
  const token = async (userId: number, scope: "read" | "write", boardId?: number) => {
    const generated = generateApiToken();
    const [row] = await db.insert(s.apiTokens).values({ userId, name: tag, scope, restricted: boardId != null, tokenHash: generated.hash, prefix: generated.prefix }).returning();
    if (boardId != null) await db.insert(s.apiTokenBoards).values({ tokenId: row.id, boardId });
    return generated.token;
  };
  const write = await token(writer.id, "write"), read = await token(writer.id, "read"), readGrant = await token(reader.id, "write"), outside = await token(outsider.id, "write"), restricted = await token(owner.id, "write", other.id), admin = await token(owner.id, "write");
  const request = (bearer: string, method = "GET", data?: unknown) => new Request("http://localhost:3000/api/v1/cards", { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const mcp = (user = writer, scope: "read" | "write" = "write", boardIds: Set<number> | null = new Set([board.id])): McpContext => ({ user, scope, boardIds, accessTokenHash: "synthetic", accessTokenExpiresAt: new Date(Date.now() + 60000) });
  const upload = (bearer: string, kind = "other", purpose?: string) => {
    const data = new FormData(); data.set("kind", kind); data.set("file", new File(["%PDF-synthetic-original"], "Original.pdf", { type: "application/pdf" })); if (purpose) data.set("uploadPurpose", purpose);
    return attachmentsApi(new Request("http://localhost:3000/api/v1/cards", { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: data }), String(card.id));
  };
  const fresh = async () => (await db.select().from(s.cards).where(eq(s.cards.id, card.id)))[0];
  // Initially pending public status must never be exposed by an unrelated UPDATE.
  for (let i = 0; i < 2; i++) await db.update(s.cards).set({ title: `Pending ${i}` }).where(eq(s.cards.id, pending.id));
  const publicPending = await getApplicationStatusByToken(pending.token);
  assert.equal(publicPending?.statusName, "Bestätigung ausstehend"); assert.equal(publicPending?.canReceipt, false);
  await assert.rejects(insertPublicAttachment(pending.id, "receipt", { filename: "x.pdf", relPath: "never-written.pdf", mime: "application/pdf", size: 1 }));
  // Planning is separately revisioned and token/live access protected.
  const plan = { revision: 0, allocations: [{ amountCents: 5000, budgetTitle: "HT 1" }, { amountCents: 10000, budgetTitle: "HT 2" }] };
  for (const [bearer, status] of [[read, 403], [readGrant, 403], [outside, 404], [restricted, 404]] as const) {
    assert.equal((await budgetPlanApi(request(bearer, "PATCH", plan), String(card.id))).status, status);
    assert.equal((await lockCardApi(request(bearer, "POST", { confirm: true, expectedStatusId: accepted.id }), String(card.id))).status, status);
  }
  assert.equal((await budgetPlanApi(request(write, "PATCH", plan), String(card.id))).status, 200);
  assert.equal((await budgetPlanApi(request(write, "PATCH", plan), String(card.id))).status, 409);
  assert.equal((await fresh()).approvedAmount, 10000);
  const detail = await (await GET(request(write), params(card.id))).json();
  assert.equal(detail.card.lockedAt, null);
  const old = await (await upload(write, "finance_request")).json();
  const comment = await (await commentsApi(request(write, "POST", { body: "Before lock" }), String(card.id))).json();
  assert.equal((await PATCH(request(write, "PATCH", { statusId: accepted.id, assigneeUserIds: [writer.id] }), params(card.id))).status, 200);
  assert.equal((await getApplicationStatusByToken(card.token))?.statusName, "Incoming");
  assert.equal((await lockCardApi(request(write, "POST", { expectedStatusId: accepted.id }), String(card.id))).status, 400);
  assert.equal((await lockCardApi(request(write, "POST", { confirm: true, expectedStatusId: incoming.id }), String(card.id))).status, 409);
  assert.equal((await callMcpTool(mcp(writer, "read"), "lock_application_card", { id: card.id, data: { confirm: true, expectedStatusId: accepted.id } })).isError, true);
  assert.equal((await callMcpTool(mcp(), "lock_application_card", { id: card.id, data: { confirm: true, expectedStatusId: accepted.id } })).isError, false);
  assert.equal((await getApplicationStatusByToken(card.token))?.statusName, "Accepted");
  const frozen = await fresh();
  for (const data of [{ title: "Changed" }, { notes: "Changed" }, { approvedAmountCents: 1 }, { assigneeUserIds: [] }, { budgetPositions: [{ id: randomUUID(), accountId: account.id, budgetTitle: "X", description: null }], budgetRevision: 0 }, { statusId: incoming.id, assigneeUserIds: [] }]) {
    assert.equal((await PATCH(request(write, "PATCH", data), params(card.id))).status, 409);
    assert.equal((await callMcpTool(mcp(), "update_card", { id: card.id, data })).isError, true);
  }
  for (const key of ["lockedAt", "lockedBy", "publicStatusId", "files", "bookingDate"]) assert.equal((await PATCH(request(admin, "PATCH", { [key]: null }), params(card.id))).status, 400);
  assert.deepEqual(await fresh(), frozen, "rejected combined requests must not partially move the card");
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await commentsApi(request(write, method, method === "DELETE" ? undefined : { body: "After lock" }), String(card.id), String(comment.comment.id))).status, 409);
  assert.equal((await DELETE(request(admin, "DELETE"), params(card.id))).status, 409);
  assert.equal((await callMcpTool(mcp(owner), "delete_card", { id: card.id })).isError, true);
  assert.equal((await budgetPlanApi(request(write, "PATCH", { ...plan, revision: 1 }), String(card.id))).status, 409);
  assert.equal((await callMcpTool(mcp(), "update_budget_plan", { id: card.id, data: { ...plan, revision: 1 } })).isError, true);
  const beforeFiles = await readdir(join(env.UPLOAD_DIR, "cards", String(card.id)), { recursive: true });
  for (const kind of ["finance_request", "other"]) assert.equal((await upload(write, kind)).status, 409);
  assert.deepEqual(await readdir(join(env.UPLOAD_DIR, "cards", String(card.id)), { recursive: true }), beforeFiles);
  assert.equal(await (await attachmentsApi(request(write), String(card.id), String(old.attachment.id))).text(), "%PDF-synthetic-original");
  assert.equal((await upload(read, "other", "receipt")).status, 403);
  const receipt = await (await upload(write, "other", "receipt")).json(); assert.equal(receipt.attachment.uploadPurpose, "receipt"); assert.match(receipt.attachment.filename, /AN-0001_Q1\.pdf$/);
  const mcpReceipt = await callMcpTool(mcp(), "upload_attachment", { id: card.id, kind: "other", uploadPurpose: "receipt", filename: "Quittung.pdf", mime: "application/pdf", dataBase64: Buffer.from("%PDF-synthetic-receipt").toString("base64") });
  assert.equal(mcpReceipt.isError, false); assert.match(JSON.stringify(mcpReceipt.structuredContent), /AN-0001_Q2/);
  const publicView = await getApplicationStatusByToken(card.token);
  assert.equal(publicView?.canUploadDocuments, false); assert.equal(publicView?.canResubmit, false); assert.equal(publicView?.canReceipt, true);
  for (const secret of ["lockedAt", "lockedBy", "accountId", "allocations", "cashbook", "iban"]) assert.equal(secret in publicView!, false);
  await assert.rejects(insertPublicAttachment(card.id, "general", { filename: "x.pdf", relPath: "never-written.pdf", mime: "application/pdf", size: 1 }));
  await assert.rejects(submitPublicWorkflow(card.id, "resubmission"));
  await insertPublicAttachment(card.id, "receipt", { filename: "x.pdf", relPath: "synthetic-unread-file.pdf", mime: "application/pdf", size: 1 });
  await submitPublicWorkflow(card.id, "receipt");
  assert.equal((await PATCH(request(write, "PATCH", { statusId: incoming.id }), params(card.id))).status, 200);
  assert.equal((await callMcpTool(mcp(), "update_card", { id: card.id, data: { statusId: accepted.id } })).isError, false);
  assert.equal((await getApplicationStatusByToken(card.token))?.statusName, "Accepted");
  assert.equal((await PATCH(request(write, "PATCH", { statusId: archived.id }), params(card.id))).status, 200);
  assert.equal((await getApplicationStatusByToken(card.token))?.canReceipt, false);
  await assert.rejects(insertPublicAttachment(card.id, "receipt", { filename: "x.pdf", relPath: "never-written.pdf", mime: "application/pdf", size: 1 }));
  await db.delete(s.boardAccess).where(eq(s.boardAccess.userId, writer.id));
  assert.equal((await callMcpTool(mcp(), "get_card", { id: card.id })).isError, true, "MCP context cannot retain revoked board access");
  assert.equal((await GET(request(write), params(card.id))).status, 404);
  // No cashbook methods in discovery schemas or MCP; session-only downloads ignore bearer auth.
  for (const spec of [openApiV1Spec, openApiPublicSpec]) assert.ok(Object.keys(spec.paths).every(path => !/cashbook|kassenbuch/i.test(path)));
  assert.ok(mcpTools.every(tool => !/cashbook|kassenbuch/i.test(tool.name + tool.path)));
  for (const name of ["create_cashbook", "authorize_cashbook", "update_cashbook", "get_cashbook"]) assert.equal((await callMcpTool(mcp(owner), name, {})).isError, true);
  for (const route of [cashbookFile, cashbookZip]) assert.equal((await route(request(admin), params(1))).status, 403);
  // The test intentionally retains immutable fixtures in this disposable database.
});
