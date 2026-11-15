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
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { moveToTrash, restoreTrashEntry } from "../lib/trash";
import { purgeTestResource } from "./helpers/trash-cleanup";

after(() => pool.end());

test("finance deletion checks both typed inputs against the locked current name and permits only admins", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const temporary = await mkdtemp(join(tmpdir(), "gremio-finance-delete-name-"));
  const entry = join(temporary, "actions.cjs");
  await build({ entryPoints: ["app/finanzen/actions.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__financeDeleteNameUser;} export async function requireAdmin(){const user=await requireUser();if(user.role!=="admin")throw Error("admin-required");return user;}' : 'export function revalidatePath(){} export function redirect(){throw Error("redirect")} export function notFound(){throw Error("not-found")}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const context = globalThis as unknown as { __financeDeleteNameUser?: s.User };
  const people = await db.insert(s.users).values(["admin", "owner", "writer"].map(role => ({ username: randomUUID(), role: role === "admin" ? "admin" as const : "user" as const }))).returning();
  const [admin, owner, writer] = people;
  const [board] = await db.insert(s.financeBoards).values({ name: "Finanzübersicht ÄÖ & 2026", ownerId: owner.id }).returning();
  const [plan] = await db.insert(s.financePlanItems).values({ financeBoardId: board.id, title: "Original plan", kind: "expense", haushaltstitel: "1000", plannedAmount: 12345, position: 0 }).returning();
  await db.insert(s.financeBoardAccess).values({ financeBoardId: board.id, userId: writer.id, accessLevel: "write" });
  const read = async () => (await db.select().from(s.financeBoards).where(eq(s.financeBoards.id, board.id)))[0];
  try {
    assert.equal(loaded.exports.deleteFinanceBoardAction, undefined, "the former settings deletion is no longer a server action");
    const action = loaded.exports.deleteFinanceBoardAdminAction;
    {
      const user = admin;
      context.__financeDeleteNameUser = user;
      for (const name of [undefined, "", "LÖSCHEN", "Wrong", board.name.toLowerCase(), board.name + " ", true, 123]) {
        assert.match((await action(board.id, "LÖSCHEN", name)).error, /Namen/);
        assert.deepEqual(await read(), board);
        assert.deepEqual((await db.select().from(s.financePlanItems).where(eq(s.financePlanItems.id, plan.id)))[0], plan);
      }
      assert.match((await action(board.id, "", board.name)).error, /LÖSCHEN/);
    }
    await assert.rejects(moveToTrash(admin, "finance", board.id, "LÖSCHEN"), /Namen/);
    for (const user of [owner, writer]) {
      context.__financeDeleteNameUser = user;
      await assert.rejects(action(board.id, "LÖSCHEN", board.name), /admin-required/);
      await assert.rejects(moveToTrash(user,"finance",board.id,"LÖSCHEN",{financeName:board.name}), /Administrationskonten/);
    }
    context.__financeDeleteNameUser = admin;
    const client = await pool.connect();
    let pending: Promise<{ error?: string }>;
    try {
      await client.query("BEGIN");
      await client.query("select id from finance_boards where id=$1 for update", [board.id]);
      pending = action(board.id, "LÖSCHEN", board.name);
      await client.query("update finance_boards set name='Aktueller vollständiger Name' where id=$1", [board.id]);
      await client.query("COMMIT");
    } finally { client.release(); }
    assert.match((await pending!).error!, /Namen/);
    assert.equal((await read()).deletedAt, null);
    await action(board.id, "LÖSCHEN", "Aktueller vollständiger Name");
    assert.ok((await read()).deletedAt);
    assert.deepEqual((await db.select().from(s.financePlanItems).where(eq(s.financePlanItems.id, plan.id)))[0], plan);
    const trash = (await pool.query("select id from trash_entries where kind='finance' and entity_id=$1 and state='trashed'", [board.id])).rows[0];
    await restoreTrashEntry(admin, trash.id, "WIEDERHERSTELLEN");
    assert.equal((await read()).deletedAt, null);
  } finally {
    await purgeTestResource("finance", board.id);
    await db.delete(s.users).where(inArray(s.users.id, people.map(user => user.id)));
    delete context.__financeDeleteNameUser;
    await rm(temporary, { recursive: true, force: true });
  }
});
