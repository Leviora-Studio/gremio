// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { encryptSecret } from "../lib/crypto";
import { generateApiToken } from "../lib/api-token";
import { getApplicationStatusByToken } from "../lib/public-status";

after(() => pool.end());

test("Nextcloud archives published statuses, waits for card locks through UI/REST/MCP, and retries without thawing contents", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-frozen-archive-")), entry = join(output, "archive.cjs");
  const exports = [
    ['lib/archive.ts', 'maybeArchive, retryPendingArchives'],
    ['lib/card-lock.ts', 'lockApplicationCard'],
    ['lib/api-application-cards.ts', 'lockCardApi'],
    ['app/api/v1/cards/[id]/route.ts', 'PATCH'],
    ['lib/mcp-tools.ts', 'callMcpTool'],
  ];
  // Keep all actual move/lock/archive code; replace only the external upload.
  await build({ stdin: { contents: exports.map(([path, names]) => `export { ${names} } from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "synthetic-nextcloud", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/nextcloud$/ }, () => ({ path: "nextcloud", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export async function testConnection(){return {ok:true};} export async function uploadAntragArchive(data){const s=globalThis.__frozenArchive;s.calls++;s.files=data.files;if(s.failures>0){s.failures--;throw Error("Synthetic upload failure");}return "/synthetic/archive/"+s.calls;}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports, context = globalThis as unknown as { __frozenArchive: { calls: number; failures: number; files: unknown[] } };
  context.__frozenArchive = { calls: 0, failures: 0, files: [] };
  const state = context.__frozenArchive;
  const [owner, reader] = await db.insert(s.users).values([{ username: `archive-owner-${randomUUID()}` }, { username: `archive-reader-${randomUUID()}` }]).returning();
  const boardIds: number[] = [];
  const token = generateApiToken();
  const [tokenRow] = await db.insert(s.apiTokens).values({ userId: owner.id, name: "Synthetic archive", tokenHash: token.hash, prefix: token.prefix, scope: "write" }).returning();
  const read = async (id: number) => (await db.select().from(s.cards).where(eq(s.cards.id, id)))[0];
  const request = (method: string, body: unknown) => new Request("http://localhost/api/v1/cards", { method, headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const move = async (id: number, statusId: number) => assert.equal((await api.PATCH(request("PATCH", { statusId }), { params: Promise.resolve({ id: String(id) }) })).status, 200);
  const createBoard = async (application: boolean) => {
    const [board] = await db.insert(s.boards).values({ name: "Synthetic archiving", ownerId: owner.id, isApplicationBoard: application }).returning(); boardIds.push(board.id);
    const [incoming, archive, lockedArchive, frozen] = await db.insert(s.boardStatuses).values([
      { boardId: board.id, name: "Incoming" }, { boardId: board.id, name: "Archive", isArchiveTrigger: true },
      { boardId: board.id, name: "Confirmed archive", isArchiveTrigger: true, isLockColumn: true },
      { boardId: board.id, name: "Frozen", isLockColumn: true },
    ]).returning();
    await db.insert(s.boardArchive).values({ boardId: board.id, enabled: true, ncUrl: "https://synthetic.invalid", ncUsername: "synthetic", ncPasswordEnc: encryptSecret("synthetic-only"), targetFolder: "/test" });
    return { board, incoming, archive, lockedArchive, frozen };
  };
  const createCard = async (boardId: number, statusId: number) => (await db.insert(s.cards).values({ boardId, statusId, title: "Immutable application", applicant: "Synthetic", notes: "Original note", token: randomUUID() }).returning())[0];
  try {
    const normal = await createBoard(false), app = await createBoard(true);
    // Ordinary columns continue archiving immediately, on both board types.
    for (const fixture of [normal, app]) {
      const card = await createCard(fixture.board.id, fixture.incoming.id), before = state.calls;
      await move(card.id, fixture.archive.id);
      assert.equal(state.calls, before + 1); assert.ok((await read(card.id)).nextcloudLink);
    }
    // All three entry points share the post-commit lock/archive behavior.
    for (const mode of ["ui", "rest", "mcp"] as const) {
      const card = await createCard(app.board.id, app.incoming.id), before = state.calls;
      await db.insert(s.attachments).values({ cardId: card.id, kind: "other", uploadPurpose: "receipt", filename: "Synthetic_Q1.pdf", path: "never-read.pdf", mime: "application/pdf", size: 1 });
      await move(card.id, app.lockedArchive.id);
      assert.equal((await read(card.id)).publicStatusId, app.incoming.id);
      assert.equal((await getApplicationStatusByToken(card.token))?.archived, false);
      await db.update(s.cards).set({ archivePending: true, archiveFirstFailedAt: new Date(), archiveLastError: "Old attempt" }).where(eq(s.cards.id, card.id));
      await api.retryPendingArchives();
      assert.equal(state.calls, before, "a pending move must never upload, even on retry");
      assert.equal((await read(card.id)).archivePending, false);
      await assert.rejects(api.lockApplicationCard(reader, card.id, app.lockedArchive.id));
      await assert.rejects(api.lockApplicationCard(owner, card.id, app.incoming.id));
      if (mode === "ui") await api.lockApplicationCard(owner, card.id, app.lockedArchive.id);
      if (mode === "rest") assert.equal((await api.lockCardApi(request("POST", { confirm: true, expectedStatusId: app.lockedArchive.id }), String(card.id))).status, 200);
      if (mode === "mcp") {
        const result = await api.callMcpTool({ user: owner, scope: "write", boardIds: null, accessTokenHash: "synthetic", accessTokenExpiresAt: new Date(Date.now() + 60000) }, "lock_application_card", { id: card.id, data: { confirm: true, expectedStatusId: app.lockedArchive.id } });
        assert.ok(!result.isError, JSON.stringify(result));
      }
      const frozen = await read(card.id);
      assert.ok(frozen.lockedAt); assert.equal(frozen.publicStatusId, app.lockedArchive.id);
      assert.ok(frozen.nextcloudLink); assert.equal(state.calls, before + 1); assert.equal(state.files.length, 1);
      assert.equal((await getApplicationStatusByToken(card.token))?.archived, true);
      await api.lockApplicationCard(owner, card.id, app.lockedArchive.id);
      await api.maybeArchive(card.id); assert.equal(state.calls, before + 1, "successful archives remain idempotent");
      for (const update of [{ title: "Tampered" }, { notes: "Tampered" }, { lockedAt: null }, { nextcloudLink: null }, { nextcloudLink: "/changed" }, { title: "Tampered", archivePending: true }]) await assert.rejects(db.update(s.cards).set(update).where(eq(s.cards.id, card.id)));
      assert.equal((await api.PATCH(request("PATCH", { nextcloudLink: "/tampered", archivePending: false }), { params: Promise.resolve({ id: String(card.id) }) })).status, 400);
      const events = await db.select().from(s.cardActivity).where(eq(s.cardActivity.cardId, card.id));
      assert.equal(events.filter(e => e.type === "locked").length, 1); assert.equal(events.filter(e => e.type === "archive").length, 1);
    }
    const fresh = await createCard(app.board.id, app.lockedArchive.id), beforeFresh = state.calls;
    assert.equal(fresh.publicStatusId, null); await api.maybeArchive(fresh.id); assert.equal(state.calls, beforeFresh);
    await api.lockApplicationCard(owner, fresh.id, app.lockedArchive.id); assert.equal(state.calls, beforeFresh + 1);
    // A previously frozen card publishes later moves immediately, without relocking.
    const alreadyFrozen = await createCard(app.board.id, app.frozen.id);
    await api.lockApplicationCard(owner, alreadyFrozen.id, app.frozen.id);
    const beforeMove = state.calls; await move(alreadyFrozen.id, app.lockedArchive.id); assert.equal(state.calls, beforeMove + 1);
    await move(alreadyFrozen.id, app.incoming.id); await move(alreadyFrozen.id, app.lockedArchive.id); assert.equal(state.calls, beforeMove + 1);
    // Failures remain retryable on frozen cards, without changing their content.
    const failing = await createCard(app.board.id, app.lockedArchive.id);
    state.failures = 1; await api.lockApplicationCard(owner, failing.id, app.lockedArchive.id);
    const failed = await read(failing.id); assert.ok(failed.lockedAt); assert.ok(failed.archiveFirstFailedAt); assert.equal(failed.archivePending, true); assert.equal(failed.nextcloudLink, null);
    assert.equal(failed.title, failing.title); assert.equal(failed.notes, failing.notes);
    const beforeRetry = state.calls; await api.retryPendingArchives(); assert.equal(state.calls, beforeRetry + 1);
    const retried = await read(failing.id); assert.ok(retried.nextcloudLink); assert.equal(retried.archivePending, false); assert.deepEqual(retried.lockedAt, failed.lockedAt);
    // Leaving the archive column cancels outstanding retries, including after lock.
    const cancelled = await createCard(app.board.id, app.lockedArchive.id);
    state.failures = 1; await api.lockApplicationCard(owner, cancelled.id, app.lockedArchive.id);
    assert.equal((await read(cancelled.id)).archivePending, true);
    const beforeCancellation = state.calls; await move(cancelled.id, app.incoming.id); await api.retryPendingArchives();
    assert.equal(state.calls, beforeCancellation); assert.equal((await read(cancelled.id)).archivePending, false);
  } finally {
    // Fixture-only cleanup in the isolated database; never disable app guards globally.
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL session_replication_role = replica");
      for (const table of ["card_activity", "attachments"]) await client.query(`DELETE FROM ${table} WHERE card_id IN (SELECT id FROM cards WHERE board_id=ANY($1))`, [boardIds]);
      for (const table of ["cards", "board_archive", "board_statuses"]) await client.query(`DELETE FROM ${table} WHERE board_id=ANY($1)`, [boardIds]);
      await client.query("DELETE FROM boards WHERE id=ANY($1)", [boardIds]);
      await client.query("DELETE FROM api_tokens WHERE id=$1", [tokenRow.id]);
      await client.query("DELETE FROM users WHERE id=ANY($1)", [[owner.id, reader.id]]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    delete (context as Partial<typeof context>).__frozenArchive;
    await rm(output, { recursive: true, force: true });
  }
});
