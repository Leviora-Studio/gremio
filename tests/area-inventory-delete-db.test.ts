// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { moveToTrash, restoreTrashEntry, purgeTrashEntry, sweepTrash } from "../lib/trash";
import { accessibleAreas, accessibleMeetings, requireArea, requireMeeting, requireTopic } from "../lib/meetings/access";
import { saveMeeting } from "../lib/meetings/service";
import { purgeTestResource } from "./helpers/trash-cleanup";

after(() => pool.end());

test("area and inventory owners delete only with both actual typed inputs; area contents survive restore and are purged together", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(env.UPLOAD_DIR, /^\/private\/tmp\/gremio-cashbook-test-/);
  const temporary = await mkdtemp(join(tmpdir(), "gremio-area-delete-"));
  const require = createRequire(import.meta.url), Module = require("node:module");
  const load = async (path: string, key: string) => {
    const entry = join(temporary, key + ".cjs");
    await build({ entryPoints: [path], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
      builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__areaDeleteUser;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("admin-required");return u;}' : 'export function revalidatePath(){} export function redirect(){throw Error("redirect")} export function notFound(){throw Error("not-found")}', loader: "js" }));
    } }] });
    const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
    loaded._compile(await readFile(entry, "utf8"), entry); return loaded.exports;
  };
  const areaActions = await load("app/intern/sitzungen/actions.ts", "areas");
  const inventoryActions = await load("app/intern/inventar/[id]/einstellungen/actions.ts", "inventory");
  const context = globalThis as unknown as { __areaDeleteUser?: s.User };
  const people = await db.insert(s.users).values(["admin", "owner", "writer", "reader", "coowner"].map(role => ({ username: randomUUID(), role: role === "admin" ? "admin" as const : "user" as const }))).returning();
  const [admin, owner, writer, reader, coowner] = people;
  const [area] = await db.insert(s.meetingAreas).values({ name: "Sitzungsbereich ÄÖ & 2026", ownerId: owner.id }).returning();
  const [inventory] = await db.insert(s.inventoryBoards).values({ name: "Inventar ÄÖ & 2026", ownerId: owner.id }).returning();
  const [item] = await db.insert(s.inventoryItems).values({ boardId: inventory.id, name: "Original item" }).returning();
  const file = `area-delete-${randomUUID()}.pdf`, template = `area-template-${randomUUID()}.docx`;
  const trashId = async (kind: string, id: number) => (await pool.query("select id from trash_entries where kind=$1 and entity_id=$2 and state='trashed'", [kind, id])).rows[0].id as number;
  try {
    await db.insert(s.inventoryBoardOwners).values({ boardId: inventory.id, userId: coowner.id });
    await db.insert(s.inventoryBoardAccess).values([{ boardId: inventory.id, userId: writer.id, accessLevel: "write" }, { boardId: inventory.id, userId: reader.id, accessLevel: "read" }]);
    await db.insert(s.inventoryBoardManagers).values({ boardId: inventory.id, userId: writer.id, grantedById: owner.id });
    await db.insert(s.meetingAreaAccess).values([{ areaId: area.id, userId: writer.id, accessLevel: "write" }, { areaId: area.id, userId: reader.id, accessLevel: "read" }]);
    const cases = [
      { kind: "meeting_area" as const, row: area, table: s.meetingAreas, action: areaActions.deleteMeetingAreaAction, option: { areaName: area.name } },
      { kind: "inventory" as const, row: inventory, table: s.inventoryBoards, action: inventoryActions.deleteInventoryBoardConfirmedAction, option: { inventoryName: inventory.name } },
    ];
    for (const entry of cases) {
      context.__areaDeleteUser = owner;
      for (const name of [undefined, "", "Wrong", entry.row.name.toLowerCase(), entry.row.name + " ", true, 123]) {
        assert.match((await entry.action(entry.row.id, "LÖSCHEN", name)).error, /Namen/);
        assert.deepEqual((await db.select().from(entry.table).where(eq(entry.table.id, entry.row.id)))[0], entry.row);
      }
      assert.match((await entry.action(entry.row.id, "", entry.row.name)).error, /LÖSCHEN/);
      await assert.rejects(moveToTrash(owner, entry.kind, entry.row.id, "LÖSCHEN"), /Namen/);
      for (const person of [reader, writer]) {
        context.__areaDeleteUser = person;
        if (entry.kind === "inventory") await assert.rejects(entry.action(entry.row.id, "LÖSCHEN", entry.row.name), /not-found/);
        else assert.match((await entry.action(entry.row.id, "LÖSCHEN", entry.row.name)).error, /Eigentümer/);
        await assert.rejects(moveToTrash(person, entry.kind, entry.row.id, "LÖSCHEN", entry.option));
      }
    }
    // Additional inventory owners have the same deletion rights, without losing item data.
    context.__areaDeleteUser = coowner;
    await assert.rejects(inventoryActions.deleteInventoryBoardConfirmedAction(inventory.id, "LÖSCHEN", inventory.name), /redirect/);
    assert.deepEqual((await db.select().from(s.inventoryItems).where(eq(s.inventoryItems.id, item.id)))[0], item);
    await restoreTrashEntry(admin, await trashId("inventory", inventory.id), "WIEDERHERSTELLEN");
    context.__areaDeleteUser = owner;
    await assert.rejects(inventoryActions.deleteInventoryBoardConfirmedAction(inventory.id, "LÖSCHEN", inventory.name), /redirect/);
    await restoreTrashEntry(admin, await trashId("inventory", inventory.id), "WIEDERHERSTELLEN");

    const meetings = await db.insert(s.meetings).values(["Live meeting", "Previously trashed"].map(title => ({ areaId: area.id, ownerId: owner.id, title }))).returning();
    const [personal] = await db.insert(s.meetingTopics).values({ createdBy: owner.id, title: "Independent personal topic" }).returning();
    const [topic] = await db.insert(s.meetingTopics).values({ meetingId: meetings[0].id, originTopicId: personal.id, createdBy: owner.id, title: "Original TOP", state: "scheduled" }).returning();
    await mkdir(env.UPLOAD_DIR, { recursive: true }); await writeFile(join(env.UPLOAD_DIR, file), "original-pdf"); await writeFile(join(env.UPLOAD_DIR, template), "original-template");
    await db.update(s.meetingAreas).set({ wordTemplatePath: template }).where(eq(s.meetingAreas.id, area.id));
    await db.insert(s.meetingDocuments).values({ topicId: topic.id, filename: "Original.pdf", path: file, mime: "application/pdf", size: 12 });
    const previouslyDeleted = await moveToTrash(owner, "meeting", meetings[1].id, "LÖSCHEN");
    const snapshot = async () => Promise.all(["meeting_areas", "meetings", "meeting_topics", "meeting_documents", "meeting_area_access"].map(async table => (await pool.query(`select to_jsonb(t)-'deleted_at' as data from ${table} t order by id`)).rows));
    const before = await snapshot();
    await assert.rejects(areaActions.deleteMeetingAreaAction(area.id, "LÖSCHEN", area.name), /redirect/);
    const removed = await trashId("meeting_area", area.id);
    assert.deepEqual(await snapshot(), before);
    for (const person of [owner, writer, reader, admin]) {
      assert.equal((await accessibleAreas(person)).some(row => row.id === area.id), false);
      assert.equal((await accessibleMeetings(person)).some(row => row.areaId === area.id), false);
      await assert.rejects(requireArea(person, area.id)); await assert.rejects(requireMeeting(person, meetings[0].id)); await assert.rejects(requireTopic(person, topic.id));
    }
    await assert.rejects(restoreTrashEntry(admin, previouslyDeleted, "WIEDERHERSTELLEN"), /Sitzungsbereich/);
    await assert.rejects(saveMeeting(owner, null, { areaId: area.id, title: "Forbidden", startsAt: "", submissionDeadline: "", location: "", chair: "", state: "planning" }));
    await assert.rejects(db.insert(s.meetings).values({ areaId: area.id, ownerId: owner.id, title: "Forbidden" }));
    await assert.rejects(db.update(s.meetingTopics).set({ title: "Forbidden" }).where(eq(s.meetingTopics.id, topic.id)));
    await assert.rejects(db.update(s.meetingAreas).set({ name: "Forbidden" }).where(eq(s.meetingAreas.id, area.id)));
    assert.equal(await readFile(join(env.UPLOAD_DIR, file), "utf8"), "original-pdf");
    await assert.rejects(restoreTrashEntry(owner, removed, "WIEDERHERSTELLEN"));
    await restoreTrashEntry(admin, removed, "WIEDERHERSTELLEN");
    assert.deepEqual(await snapshot(), before);
    assert.equal((await requireTopic(owner, topic.id)).topic.title, topic.title);
    await assert.rejects(requireMeeting(owner, meetings[1].id));
    // A stale name is rejected after a concurrent rename releases the deletion lock.
    const client = await pool.connect(); let pending: Promise<{ error?: string }>;
    try {
      await client.query("BEGIN"); await client.query("select id from meeting_areas where id=$1 for update", [area.id]);
      pending = areaActions.deleteMeetingAreaAction(area.id, "LÖSCHEN", area.name);
      await client.query("update meeting_areas set name='Current area name' where id=$1", [area.id]); await client.query("COMMIT");
    } finally { client.release(); }
    assert.match((await pending!).error!, /Namen/);
    await assert.rejects(areaActions.deleteMeetingAreaAction(area.id, "LÖSCHEN", "Current area name"), /redirect/);
    const finalTrash = await trashId("meeting_area", area.id);
    const deadline = (await pool.query("select expires_at from trash_entries where id=$1", [finalTrash])).rows[0].expires_at;
    await sweepTrash(new Date(deadline.getTime() - 1));
    assert.equal((await pool.query("select 1 from meeting_areas where id=$1", [area.id])).rowCount, 1, "the area is retained for the full 30 days");
    assert.ok(await sweepTrash(new Date(deadline.getTime() + 1)) >= 1);
    assert.equal((await pool.query("select 1 from meeting_areas where id=$1", [area.id])).rowCount, 0);
    assert.equal((await pool.query("select 1 from meetings where area_id=$1", [area.id])).rowCount, 0);
    await assert.rejects(access(join(env.UPLOAD_DIR, file))); await assert.rejects(access(join(env.UPLOAD_DIR, template)));
    assert.equal((await requireTopic(owner, personal.id)).topic.title, personal.title);
    assert.equal((await pool.query("select state from trash_entries where id=$1", [previouslyDeleted])).rows[0].state, "purged");
    await purgeTestResource("topic", personal.id);
  } finally {
    await purgeTestResource("meeting_area", area.id); await purgeTestResource("inventory", inventory.id);
    await db.delete(s.users).where(inArray(s.users.id, people.map(user => user.id)));
    delete context.__areaDeleteUser; await rm(temporary, { recursive: true, force: true });
  }
});
