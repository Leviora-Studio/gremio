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
import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { encryptSecret } from "../lib/crypto";
import { moveToTrash, restoreTrashEntry, purgeTrashEntry } from "../lib/trash";
after(() => pool.end());

test("archive outbox commits with status/lock, survives process death and lock contention, and acknowledges uploads atomically", { timeout: 45000 }, async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-archive-outbox-")), entry = join(output, "archive.cjs");
  await build({ entryPoints: ["lib/archive.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "synthetic-upload", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/nextcloud$/ }, () => ({ path: "nextcloud", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `export async function testConnection(){return {ok:true};} export async function uploadAntragArchive(data){const state=globalThis.__outboxTest;state.calls++;if(state.pause){process.send?.({uploading:true});await new Promise(()=>{});}await new Promise(r=>setTimeout(r,5));return '/synthetic/outbox/'+data.subfolder;}`, loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module"), loaded = new Module(entry, module);
  loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports, context = globalThis as unknown as { __outboxTest: { calls: number; pause: boolean } };
  context.__outboxTest = { calls: 0, pause: false };
  const [owner] = await db.insert(s.users).values({ username: `outbox-${randomUUID()}`, role: "admin" }).returning();
  const [board] = await db.insert(s.boards).values({ name: "Durable archive", ownerId: owner.id, isApplicationBoard: true }).returning();
  const [incoming, archive, locked] = await db.insert(s.boardStatuses).values([{ boardId: board.id, name: "Open" }, { boardId: board.id, name: "Archive", isArchiveTrigger: true }, { boardId: board.id, name: "Locked archive", isArchiveTrigger: true, isLockColumn: true }]).returning();
  await db.insert(s.boardArchive).values({ boardId: board.id, enabled: true, ncUrl: "https://synthetic.invalid", ncUsername: "synthetic", ncPasswordEnc: encryptSecret("synthetic-only"), targetFolder: "/synthetic", folderFields: "id" });
  const card = async () => (await db.insert(s.cards).values({ boardId: board.id, statusId: incoming.id, title: "Original", applicant: "Synthetic", token: randomUUID() }).returning())[0];
  const job = async (id: number) => (await db.select().from(s.nextcloudArchiveJobs).where(eq(s.nextcloudArchiveJobs.cardId, id)))[0];
  const read = async (id: number) => (await db.select().from(s.cards).where(eq(s.cards.id, id)))[0];
  let child: ChildProcess | undefined, ackTrigger = false;
  try {
    const rolledBack = await card();
    await assert.rejects(db.transaction(async tx => {
      await tx.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, rolledBack.id));
      assert.equal((await tx.select().from(s.nextcloudArchiveJobs).where(eq(s.nextcloudArchiveJobs.cardId, rolledBack.id))).length, 1);
      assert.equal(await job(rolledBack.id), undefined, "an uncommitted job is invisible to another session");
      throw new Error("synthetic rollback");
    }));
    assert.equal(await job(rolledBack.id), undefined); assert.equal((await read(rolledBack.id)).statusId, incoming.id);
    // Simulate losing the entire post-commit handler: only raw DB writes run.
    const committed = await card(); await db.update(s.cards).set({ statusId: locked.id }).where(eq(s.cards.id, committed.id));
    assert.equal(await job(committed.id), undefined, "unconfirmed lock columns never queue");
    await db.update(s.cards).set({ lockedAt: new Date(), lockedBy: owner.id }).where(eq(s.cards.id, committed.id));
    assert.equal((await job(committed.id)).attempts, 0); assert.equal((await read(committed.id)).archivePending, false, "waiting jobs are not failed uploads");
    await api.retryPendingArchives(); assert.ok((await read(committed.id)).nextcloudLink); assert.equal(await job(committed.id), undefined);
    await assert.rejects(db.update(s.cards).set({ title: "Tampered" }).where(eq(s.cards.id, committed.id)));
    // A skipped nonblocking lock attempt must not discard the queued work.
    const skipped = await card(); await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, skipped.id));
    const locker = await pool.connect(); const before = context.__outboxTest.calls;
    try { await locker.query("select pg_advisory_lock($1,$2)", [0x5747, skipped.id]); await api.maybeArchive(skipped.id); assert.equal(context.__outboxTest.calls, before); assert.equal((await job(skipped.id)).attempts, 0); }
    finally { await locker.query("select pg_advisory_unlock($1,$2)", [0x5747, skipped.id]); locker.release(); }
    await api.retryPendingArchives(); assert.ok((await read(skipped.id)).nextcloudLink); assert.equal(await job(skipped.id), undefined);
    // Kill a real separate process while it holds the delivery lock in upload.
    const interrupted = await card(); await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, interrupted.id));
    const script = `const fs=require('node:fs'),Module=require('node:module');globalThis.__outboxTest={calls:0,pause:true};const path=${JSON.stringify(entry)},loaded=new Module(path,module);loaded.filename=path;loaded.paths=module.paths;loaded._compile(fs.readFileSync(path,'utf8'),path);loaded.exports.maybeArchive(${interrupted.id}).catch(error=>{console.error(error);process.exit(1);});`;
    child = spawn(process.execPath, ["-e", script], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let childLog = ""; child.stderr?.on("data", chunk => { childLog += chunk; });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Child did not enter upload: ${childLog}`)), 10000); child!.once("message", () => { clearTimeout(timer); resolve(); }); child!.once("error", error => { clearTimeout(timer); reject(error); }); child!.once("exit", code => { if(code!==null){clearTimeout(timer);reject(new Error(childLog));} }); });
    assert.equal((await job(interrupted.id)).attempts, 1); assert.equal((await read(interrupted.id)).nextcloudLink, null);
    const exit = new Promise(resolve => child!.once("exit", resolve)); child.kill("SIGKILL"); await exit; child = undefined;
    await api.retryPendingArchives(); assert.ok((await read(interrupted.id)).nextcloudLink); assert.equal(await job(interrupted.id), undefined);
    // A failed local acknowledgement after a successful upload cannot lose work.
    const unacknowledged = await card(); await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, unacknowledged.id));
    await pool.query(`create function test_archive_ack_failure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic acknowledgement failure'; end $$; create trigger test_archive_ack_failure before insert on card_activity for each row when (NEW.type='archive' and NEW.card_id=${unacknowledged.id}) execute function test_archive_ack_failure()`); ackTrigger = true;
    await api.maybeArchive(unacknowledged.id); assert.equal((await read(unacknowledged.id)).nextcloudLink, null); assert.equal((await job(unacknowledged.id)).attempts, 1); assert.ok((await job(unacknowledged.id)).lastError);
    await pool.query("drop trigger test_archive_ack_failure on card_activity; drop function test_archive_ack_failure()"); ackTrigger = false;
    await api.retryPendingArchives(); assert.ok((await read(unacknowledged.id)).nextcloudLink); assert.equal(await job(unacknowledged.id), undefined);
    assert.equal((await db.select().from(s.cardActivity).where(eq(s.cardActivity.cardId, unacknowledged.id))).filter(event => event.type === "archive").length, 1);
    const cancelled = await card(); await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, cancelled.id)); await db.update(s.cards).set({ statusId: incoming.id }).where(eq(s.cards.id, cancelled.id));
    const cancelledCalls = context.__outboxTest.calls; await api.retryPendingArchives(); assert.equal(context.__outboxTest.calls, cancelledCalls); assert.equal(await job(cancelled.id), undefined);
    await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, cancelled.id)); assert.ok(await job(cancelled.id));
    await db.update(s.boardArchive).set({ enabled: false }).where(eq(s.boardArchive.boardId, board.id)); await api.retryPendingArchives(); assert.equal(await job(cancelled.id), undefined);
    await db.update(s.boardArchive).set({ enabled: true }).where(eq(s.boardArchive.boardId, board.id)); assert.ok(await job(cancelled.id));
    const trash = await moveToTrash(owner, "board", board.id, "LÖSCHEN", {boardName:board.name}); const pausedCalls = context.__outboxTest.calls; await api.retryPendingArchives(); assert.equal(context.__outboxTest.calls, pausedCalls); assert.ok(await job(cancelled.id));
    await restoreTrashEntry(owner, trash, "WIEDERHERSTELLEN"); await api.retryPendingArchives(); assert.ok((await read(cancelled.id)).nextcloudLink);
    // More simultaneous archives than the main pool size must still finish.
    const concurrent = await Promise.all(Array.from({ length: 14 }, card));
    for (const row of concurrent) await db.update(s.cards).set({ statusId: archive.id }).where(eq(s.cards.id, row.id));
    await Promise.all(concurrent.map(row => api.maybeArchive(row.id)));
    for (const row of concurrent) { assert.ok((await read(row.id)).nextcloudLink); assert.equal(await job(row.id), undefined); }
  } finally {
    if (child) { const exit = new Promise(resolve => child!.once("exit", resolve)); child.kill("SIGKILL"); await exit; }
    if (ackTrigger) await pool.query("drop trigger if exists test_archive_ack_failure on card_activity; drop function if exists test_archive_ack_failure()");
    const entryId = await moveToTrash(owner, "board", board.id, "LÖSCHEN", {boardName:board.name}); await purgeTrashEntry(owner, entryId, "ENDGÜLTIG"); await db.delete(s.users).where(eq(s.users.id, owner.id));
    delete (context as Partial<typeof context>).__outboxTest; await rm(output, { recursive: true, force: true });
  }
});
