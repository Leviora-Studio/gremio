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
import { deleteConfirmationError, roleConfirmationWord } from "../lib/confirmation";

after(() => pool.end());

test("delete confirmation accepts only the word shown by the UI", () => {
  for (const input of [undefined, null, "", "DELETE", "LOESCHEN", true, 1, {}, ["LÖSCHEN"]]) assert.ok(deleteConfirmationError(input));
  for (const input of ["LÖSCHEN", "löschen", " LÖSCHEN "]) assert.equal(deleteConfirmationError(input), undefined);
});

test("every typed deletion action and legacy alias rejects missing/wrong words without writes", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-typed-confirmations-")), entry = join(output, "actions.cjs");
  const modules = { board: "app/intern/board/[id]/einstellungen/actions.ts", inventory: "app/intern/inventar/[id]/einstellungen/actions.ts", adminBoard: "app/admin/boards/actions.ts", finance: "app/finanzen/actions.ts", groups: "app/admin/groups/actions.ts", accounts: "app/admin/accounts/actions.ts", priorities: "app/admin/priorities/actions.ts", locations: "app/admin/standorte/actions.ts", feedback: "app/admin/umfragen/actions.ts", boardTemplate: "app/vorlagen/boards/actions.ts", financeTemplate: "app/vorlagen/finanzen/actions.ts", meetingTemplate: "app/vorlagen/sitzungsbereiche/actions.ts", meetings: "app/intern/sitzungen/actions.ts", roles: "app/admin/users/actions.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){const u=globalThis.__typedConfirmationUser;if(!u?.isActive)throw Error("login");return u;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("admin-required");return u;} export function canManageTemplates(u){return u.role==="admin"||u.role==="template_manager";} export async function requireTemplateManager(){const u=await requireUser();if(!canManageTemplates(u))throw Error("template-required");return u;}' : 'export function notFound(){throw Error("not-found")} export function redirect(path){throw Error("redirect:"+path)} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports, context = globalThis as unknown as { __typedConfirmationUser?: s.User };
  const [admin, roleTarget] = await db.insert(s.users).values([{ username: `confirmation-admin-${randomUUID()}`, role: "admin" }, { username: `confirmation-role-${randomUUID()}` }]).returning();
  context.__typedConfirmationUser = admin;
  const boards = await db.insert(s.boards).values([0, 1, 2, 3].map(i => ({ name: `Confirmation board ${i}`, ownerId: admin.id }))).returning();
  const [inventory] = await db.insert(s.inventoryBoards).values({ name: "Confirmation inventory", ownerId: admin.id }).returning();
  const finances = await db.insert(s.financeBoards).values([0, 1].map(i => ({ name: `Confirmation finances ${i}`, ownerId: admin.id }))).returning();
  const [group] = await db.insert(s.groups).values({ name: `confirmation-group-${randomUUID()}` }).returning();
  const [account] = await db.insert(s.accounts).values({ name: `confirmation-account-${randomUUID()}` }).returning();
  const [priority] = await db.insert(s.priorities).values({ label: "Confirmation priority" }).returning();
  const [location] = await db.insert(s.locations).values({ name: `confirmation-location-${randomUUID()}`, enabled: false }).returning();
  const [feedback] = await db.insert(s.feedbackAreas).values({ name: `confirmation-feedback-${randomUUID()}`, enabled: false }).returning();
  const [boardTemplate] = await db.insert(s.boardTemplates).values({ name: `confirmation-board-template-${randomUUID()}` }).returning();
  const [financeTemplate] = await db.insert(s.financeTemplates).values({ name: `confirmation-finance-template-${randomUUID()}` }).returning();
  const [meetingTemplate] = await db.insert(s.meetingAreaTemplates).values({ name: `confirmation-meeting-template-${randomUUID()}` }).returning();
  const [area] = await db.insert(s.meetingAreas).values({ name: "Confirmation area", ownerId: admin.id }).returning();
  const meetings = await db.insert(s.meetings).values([0, 1, 2].map(i => ({ areaId: area.id, ownerId: admin.id, title: `Confirmation meeting ${i}` }))).returning();
  const topics = await db.insert(s.meetingTopics).values([{ createdBy: admin.id, title: "Personal topic" }, { createdBy: admin.id, title: "Scheduled topic", meetingId: meetings[2].id }, { createdBy: admin.id, title: "Legacy topic" }]).returning();
  type Case = { name: string; table: string; id: number; run: (word: unknown) => Promise<unknown> };
  const form = (word: unknown) => { const f = new FormData(); f.set("confirmDelete", "on"); if (word !== undefined) f.set("confirmation", String(word)); return f; };
  const boardForm = (word: unknown, name: string) => { const data=form(word); data.set("boardName",name); return data; };
  const cases: Case[] = [
    { name: "board", table: "boards", id: boards[0].id, run: word => api.board.deleteBoardConfirmedAction(boards[0].id, word, boards[0].name) },
    { name: "legacy board", table: "boards", id: boards[1].id, run: word => api.board.deleteBoardAction(boards[1].id, {}, boardForm(word, boards[1].name)) },
    { name: "admin board", table: "boards", id: boards[2].id, run: word => api.adminBoard.deleteBoardAdminConfirmedAction(boards[2].id, word, boards[2].name) },
    { name: "legacy admin board", table: "boards", id: boards[3].id, run: word => api.adminBoard.deleteBoardAdminAction(boards[3].id, {}, boardForm(word, boards[3].name)) },
    { name: "inventory", table: "inventory_boards", id: inventory.id, run: word => api.inventory.deleteInventoryBoardConfirmedAction(inventory.id, word, inventory.name) },
    { name: "finance", table: "finance_boards", id: finances[0].id, run: word => api.finance.deleteFinanceBoardAdminAction(finances[0].id, word, finances[0].name) },
    { name: "admin finance", table: "finance_boards", id: finances[1].id, run: word => api.finance.deleteFinanceBoardAdminAction(finances[1].id, word, finances[1].name) },
    { name: "group", table: "groups", id: group.id, run: word => api.groups.deleteGroupAction(group.id, word, group.name) },
    { name: "account", table: "accounts", id: account.id, run: word => api.accounts.deleteAccountAction(account.id, word) },
    { name: "priority", table: "priorities", id: priority.id, run: word => api.priorities.deletePriorityAction(priority.id, word) },
    { name: "location", table: "locations", id: location.id, run: word => api.locations.deleteLocationAction(location.id, word) },
    { name: "feedback", table: "feedback_areas", id: feedback.id, run: word => api.feedback.deleteFeedbackAreaAction(feedback.id, word) },
    { name: "board template", table: "board_templates", id: boardTemplate.id, run: word => api.boardTemplate.deleteTemplateAction(boardTemplate.id, word,boardTemplate.name) },
    { name: "finance template", table: "finance_templates", id: financeTemplate.id, run: word => api.financeTemplate.deleteFinanceTemplateAction(financeTemplate.id, word,financeTemplate.name) },
    { name: "meeting template", table: "meeting_area_templates", id: meetingTemplate.id, run: word => api.meetingTemplate.deleteMeetingTemplateAction(meetingTemplate.id, 0, word,meetingTemplate.name) },
    { name: "meeting", table: "meetings", id: meetings[0].id, run: word => api.meetings.confirmedDeleteMeetingAction(meetings[0].id, word) },
    { name: "legacy meeting", table: "meetings", id: meetings[1].id, run: word => api.meetings.deleteMeetingAction(meetings[1].id, {}, form(word)) },
    { name: "personal topic", table: "meeting_topics", id: topics[0].id, run: word => api.meetings.confirmedDeleteTopicAction(topics[0].id, word) },
    { name: "meeting topic", table: "meeting_topics", id: topics[1].id, run: word => api.meetings.confirmedDeleteTopicAction(topics[1].id, word) },
    { name: "legacy topic", table: "meeting_topics", id: topics[2].id, run: word => api.meetings.deleteTopicAction(topics[2].id, {}, form(word)) },
  ];
  const read = async (entry: Case) => (await pool.query(`SELECT to_jsonb(t) AS data FROM "${entry.table}" t WHERE id=$1`, [entry.id])).rows[0]?.data;
  try {
    for (const entry of cases) {
      const before = await read(entry); assert.ok(before, entry.name);
      for (const word of [undefined, "", "LOESCHEN", "BESTÄTIGEN", true, {}]) {
        const result = await entry.run(word) as { error?: string };
        assert.match(result?.error ?? "", /LÖSCHEN/, `${entry.name}: missing/invalid word rejected`);
        assert.deepEqual(await read(entry), before, `${entry.name}: rejected call cannot mutate the record`);
      }
      try { const result = await entry.run("LÖSCHEN") as { error?: string } | undefined; assert.ok(!result?.error, `${entry.name}: ${result?.error}`); }
      catch (error) { assert.match(String(error), /redirect:/, `${entry.name}: only redirects are expected after deletion`); }
      const retained = await read(entry); assert.ok(retained.deleted_at, `${entry.name}: valid confirmation moves to trash`);
      const {deleted_at:_deleted,...contents}=retained;const {deleted_at:_before,...original}=before;assert.deepEqual(contents,original,`${entry.name}: all content remains intact`);
    }
    for (const target of ["admin", "template_manager", "user"] as const) {
      const [current] = await db.select().from(s.users).where(eq(s.users.id, roleTarget.id));
      const expected = roleConfirmationWord(current.role, target);
      for (const word of [undefined, "", "LÖSCHEN", "wrong", expected.toLowerCase(), ...["ADMIN", "TEMPLATE", "ENTZIEHEN"].filter(word => word !== expected), true, {}]) {
        assert.ok((await api.roles.setRoleAction(roleTarget.id, target, word))?.error);
        assert.equal((await db.select().from(s.users).where(eq(s.users.id, roleTarget.id)))[0].role, current.role);
      }
      await api.roles.setRoleAction(roleTarget.id, target, expected);
      assert.equal((await db.select().from(s.users).where(eq(s.users.id, roleTarget.id)))[0].role, target);
    }
    await api.roles.setRoleAction(roleTarget.id, "template_manager", "TEMPLATE");
    assert.equal((await db.select().from(s.users).where(eq(s.users.id, roleTarget.id)))[0].role, "template_manager", "promotion to template manager has its own word");
  } finally {
    delete context.__typedConfirmationUser;
    // Fixture-only cleanup after the lifecycle assertions, never normal app data.
    const cleanup=await pool.connect();
    try {await cleanup.query("BEGIN");await cleanup.query("SET LOCAL session_replication_role=replica");
      for(const entry of cases)await cleanup.query(`DELETE FROM "${entry.table}" WHERE id=$1`,[entry.id]);
      await cleanup.query("DELETE FROM meetings WHERE id=$1",[meetings[2].id]);
      await cleanup.query("DELETE FROM meeting_areas WHERE id=$1",[area.id]);
      await cleanup.query("DELETE FROM trash_entries WHERE deleted_by=$1",[admin.id]);
      await cleanup.query("DELETE FROM users WHERE id=ANY($1)",[[admin.id,roleTarget.id]]);await cleanup.query("COMMIT");
    }catch(error){await cleanup.query("ROLLBACK");throw error;}finally{cleanup.release();}
    await rm(output, { recursive: true, force: true });
  }
});
