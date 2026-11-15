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

test("board deletion requires the actual current name; application boards are deleted only by admin actions", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const temporary = await mkdtemp(join(tmpdir(), "gremio-board-delete-name-"));
  const require = createRequire(import.meta.url), Module = require("node:module");
  const load = async (path: string, key: string) => {
    const entry = join(temporary, key + ".cjs");
    await build({ entryPoints: [path], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
      builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__boardDeleteNameUser;} export async function requireAdmin(){const user=await requireUser();if(user.role!=="admin")throw Error("admin-required");return user;}' : 'export function revalidatePath(){} export function redirect(){throw Error("redirect")} export function notFound(){throw Error("not-found")}', loader: "js" }));
    } }] });
    const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
    loaded._compile(await readFile(entry, "utf8"), entry); return loaded.exports;
  };
  const settings = await load("app/intern/board/[id]/einstellungen/actions.ts", "settings");
  const adminActions = await load("app/admin/boards/actions.ts", "admin");
  const context = globalThis as unknown as { __boardDeleteNameUser?: s.User };
  const people = await db.insert(s.users).values(["admin", "owner", "writer"].map(role => ({ username: randomUUID(), role: role === "admin" ? "admin" as const : "user" as const }))).returning();
  const [admin, owner, writer] = people;
  const boards = await db.insert(s.boards).values([false, true].map(isApplicationBoard => ({ name: isApplicationBoard ? "Antragsboard ÄÖ & 2026" : "Board ÄÖ & 2026", ownerId: owner.id, isApplicationBoard }))).returning();
  const read = async (id: number) => (await db.select().from(s.boards).where(eq(s.boards.id, id)))[0];
  try {
    await db.insert(s.boardAccess).values(boards.map(board => ({ boardId: board.id, userId: writer.id, accessLevel: "write" as const })));
    for (const board of boards) {
      context.__boardDeleteNameUser = admin;
      for (const name of [undefined, "", "Wrong", board.name.toLowerCase(), board.name + " ", true, 123]) {
        assert.match((await adminActions.deleteBoardAdminConfirmedAction(board.id, "LÖSCHEN", name)).error, /Namen/);
        assert.deepEqual(await read(board.id), board);
      }
      const form = new FormData(); form.set("confirmation", "LÖSCHEN");
      assert.match((await adminActions.deleteBoardAdminAction(board.id, {}, form)).error, /Namen/);
      await assert.rejects(moveToTrash(admin, "board", board.id, "LÖSCHEN"), /Namen/);
      context.__boardDeleteNameUser = owner;
      await assert.rejects(adminActions.deleteBoardAdminConfirmedAction(board.id, "LÖSCHEN", board.name), /admin-required/);
      if (board.isApplicationBoard) {
        for (const user of [owner, admin]) {
          context.__boardDeleteNameUser = user;
          assert.match((await settings.deleteBoardConfirmedAction(board.id, "LÖSCHEN", board.name)).error, /Admin-Panel/);
          form.set("boardName", board.name);
          assert.match((await settings.deleteBoardAction(board.id, {}, form)).error, /Admin-Panel/);
        }
        await assert.rejects(moveToTrash(owner, "board", board.id, "LÖSCHEN", { boardName: board.name }), /Administrationskonten/);
      } else {
        assert.match((await settings.deleteBoardConfirmedAction(board.id, "LÖSCHEN")).error, /Namen/);
        assert.match((await settings.deleteBoardAction(board.id, {}, form)).error, /Namen/);
        assert.match((await settings.deleteBoardConfirmedAction(board.id, "", board.name)).error, /LÖSCHEN/);
        await assert.rejects(settings.deleteBoardConfirmedAction(board.id, "LÖSCHEN", board.name), /redirect/);
        const trash = (await pool.query("select id from trash_entries where kind='board' and entity_id=$1 and state='trashed'", [board.id])).rows[0];
        await restoreTrashEntry(admin, trash.id, "WIEDERHERSTELLEN");
        context.__boardDeleteNameUser = writer;
        await assert.rejects(settings.deleteBoardConfirmedAction(board.id, "LÖSCHEN", board.name), /not-found/);
      }
      context.__boardDeleteNameUser = admin;
      await adminActions.deleteBoardAdminConfirmedAction(board.id, "LÖSCHEN", board.name);
      assert.ok((await read(board.id)).deletedAt);
    }
  } finally {
    for (const board of boards) await purgeTestResource("board", board.id);
    await db.delete(s.users).where(inArray(s.users.id, people.map(user => user.id)));
    delete context.__boardDeleteNameUser;
    await rm(temporary, { recursive: true, force: true });
  }
});
