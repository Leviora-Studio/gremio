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
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { canConfigureAreaSettings, requireArea, requireMeeting, requireTopic } from "../lib/meetings/access";
import { getMeetingAreaManagementPeople, setMeetingAreaManager } from "../lib/board-management";
import { saveArea } from "../lib/meetings/service";
import { wordTemplateSettings } from "../lib/meetings/word";
import { wordTemplateFixture } from "./word-template-fixture";
import { purgeTestResource } from "./helpers/trash-cleanup";
import { moveToTrash, restoreTrashEntry } from "../lib/trash";
after(() => pool.end());

test("meeting delegates configure all settings with live direct/group write rights, without deletion, ownership or appointment privileges", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(process.env.UPLOAD_DIR!, /^\/private\/tmp\/gremio-cashbook-test-/);
  const temporary = await mkdtemp(join(tmpdir(), "gremio-area-management-")), entry = join(temporary, "actions.cjs");
  const modules = { settings: "app/intern/sitzungen/actions.ts", management: "app/intern/sitzungen/bereich/[id]/einstellungen/management-actions.ts", defaults: "app/vorlagen/sitzungsbereiche/actions.ts", download: "app/api/meeting-areas/[id]/word-template/route.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__areaManagerUser;} export const getCurrentUser=requireUser; export function canManageTemplates(u){return ["admin","template_manager"].includes(u.role);} export async function requireTemplateManager(){const u=await requireUser();if(!canManageTemplates(u))throw Error("template-denied");return u;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module"), loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry); const api = loaded.exports;
  const context = globalThis as unknown as { __areaManagerUser?: s.User };
  const people = await db.insert(s.users).values(["owner", "admin", "writer", "group", "reader", "outside", "inactive"].map(role => ({ username: `area-${role}-${randomUUID()}`, role: role === "admin" ? "admin" as const : "user" as const, isActive: role !== "inactive" }))).returning();
  const [owner, admin, writer, groupWriter, reader, outsider, inactive] = people;
  const [area, other] = await db.insert(s.meetingAreas).values([{ name: "Managed area", ownerId: owner.id }, { name: "Unrelated area", ownerId: outsider.id }]).returning();
  const [group] = await db.insert(s.groups).values({ name: randomUUID() }).returning();
  const [board, foreign] = await db.insert(s.boards).values([{ name: "Writer's board", ownerId: writer.id }, { name: "Other board", ownerId: owner.id }]).returning();
  const statuses = await db.insert(s.boardStatuses).values([{ boardId: board.id, name: "Planned" }, { boardId: foreign.id, name: "Private" }]).returning();
  const [meeting] = await db.insert(s.meetings).values({ areaId: area.id, ownerId: owner.id, title: "Meeting" }).returning();
  const [secret] = await db.insert(s.meetingTopics).values({ meetingId: meeting.id, createdBy: owner.id, title: "Confidential", confidential: true }).returning();
  const form = (values: Record<string, string> = {}) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
  const current = () => requireArea(owner, area.id, "manage");
  try {
    await db.insert(s.meetingAreaAccess).values([{ areaId: area.id, userId: writer.id, accessLevel: "write" }, { areaId: area.id, userId: groupWriter.id, accessLevel: "read" }, { areaId: area.id, userId: reader.id, accessLevel: "read" }, { areaId: area.id, userId: inactive.id, accessLevel: "write" }, { areaId: area.id, groupId: group.id, accessLevel: "write" }]);
    await db.insert(s.userGroups).values({ userId: groupWriter.id, groupId: group.id });
    assert.deepEqual((await getMeetingAreaManagementPeople(area.id)).candidates.map(p => p.id).sort(), [writer.id, groupWriter.id].sort());
    for (const person of [reader, inactive, outsider]) await assert.rejects(setMeetingAreaManager(owner, area.id, person.id, true), /schreibenden Zugriff/);
    await assert.rejects(setMeetingAreaManager(writer, area.id, writer.id, true), /Nur Eigentümer/);
    context.__areaManagerUser = owner;
    assert.ok((await api.management.setMeetingAreaManagerAction(area.id, {}, form({ userId: String(writer.id), operation: "add" }))).success);
    await setMeetingAreaManager(admin, area.id, groupWriter.id, true);
    for (const person of [writer, groupWriter]) { assert.equal(await canConfigureAreaSettings(person, area), true); await requireArea(person, area.id, "settings"); await assert.rejects(requireArea(person, area.id, "manage")); await assert.rejects(requireMeeting(person, meeting.id, "manage")); await assert.rejects(requireTopic(person, secret.id)); }
    assert.equal(await canConfigureAreaSettings(writer, other), false);
    context.__areaManagerUser = writer;
    await assert.rejects(api.management.setMeetingAreaManagerAction(area.id, {}, form({ userId: String(reader.id), operation: "add" })), /Zugriff/);
    await assert.rejects(api.management.setMeetingAreaManagerAction(area.id, {}, form({ userId: String(groupWriter.id), operation: "remove" })), /Zugriff/);
    assert.ok((await api.settings.deleteMeetingAreaAction(area.id, "LÖSCHEN", area.name)).error);
    assert.ok((await api.settings.confirmedDeleteMeetingAction(meeting.id, "LÖSCHEN")).error);
    assert.ok((await api.settings.saveAreaAction(area.id, {}, form({ name: "Configured name", description: "Configured description" }))).success);
    assert.ok((await api.settings.saveAgendaSettingsAction(area.id, {}, form({ publicNumbering: "roman", nonPublicNumbering: "arabic", firstSection: "non_public" }))).success);
    assert.ok((await api.defaults.applyMeetingTemplateAction(area.id, {}, form({ templateId: "", revision: "0" }))).success);
    assert.ok((await api.defaults.saveAreaDefaultsAction(area.id, {}, form({ revision: "1", topics: "[]", includeMiscellaneous: "on" }))).success);
    const upload = form({ revision: "0" }); upload.set("template", new File([new Uint8Array(wordTemplateFixture())], "Managed.docx"));
    assert.ok((await api.settings.uploadWordTemplateAction(area.id, {}, upload)).success);
    const info = await wordTemplateSettings(writer, area.id); assert.ok(info);
    const download = await api.download.GET(new Request("http://localhost/template"), { params: Promise.resolve({ id: String(area.id) }) }); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), wordTemplateFixture());
    const configuration = form({ revision: "1", insertion:info.configuration.insertion, start:String(info.configuration.start),end:String(info.configuration.end) });
    for (const [key, value] of Object.entries(info.configuration.styles)) configuration.set("style_" + key, value);
    assert.ok((await api.settings.saveWordConfigurationAction(area.id, {}, configuration)).success);
    assert.ok((await api.settings.removeWordTemplateAction(area.id, {}, form({ revision: "2",confirmation:"LÖSCHEN",templateName:"Managed.docx" }))).success);
    assert.equal((await current()).wordTemplatePath, null);
    assert.ok((await api.settings.saveFinanceConfigurationAction(area.id, {}, form({ boardId: String(board.id), targetStatusId: String(statuses[0].id) }))).success);
    // Source board rights remain independent of area delegation.
    const { saveFinanceConfiguration } = await import("../lib/meetings/finance");
    await saveFinanceConfiguration(writer, area.id, board.id, [], statuses[0].id, "");
    await assert.rejects(saveFinanceConfiguration(writer, area.id, foreign.id, [], statuses[1].id, ""), /Verwaltungsrechte/);
    assert.ok((await api.settings.bindBoardAction(meeting.id, {}, form({ boardId: String(board.id) }))).success);
    assert.equal((await db.select().from(s.meetingBoards).where(eq(s.meetingBoards.meetingId, meeting.id))).length, 1);
    assert.ok((await api.settings.areaGrantAction(area.id, {}, form({ subject: "user", subjectId: String(outsider.id), accessLevel: "write" }))).success);
    assert.equal(await canConfigureAreaSettings(outsider, await current()), false, "sharing alone grants no delegation");
    assert.equal((await current()).ownerId, owner.id);
    await db.delete(s.userGroups).where(eq(s.userGroups.userId, groupWriter.id));
    assert.equal(await canConfigureAreaSettings(groupWriter, await current()), false);
    assert.equal((await getMeetingAreaManagementPeople(area.id)).managers.find(p => p.id === groupWriter.id)?.active, false);
    await db.insert(s.userGroups).values({ userId: groupWriter.id, groupId: group.id });
    assert.equal(await canConfigureAreaSettings(groupWriter, await current()), true);
    const grant = (await db.select().from(s.meetingAreaAccess).where(and(eq(s.meetingAreaAccess.areaId, area.id), eq(s.meetingAreaAccess.userId, writer.id))))[0];
    assert.ok((await api.settings.areaGrantAction(area.id, {}, form({ subject: "user", subjectId: String(writer.id), accessLevel: "read" }))).success);
    assert.equal(await canConfigureAreaSettings(writer, await current()), false);
    assert.ok((await api.settings.saveAreaAction(area.id, {}, form({ name: "Forbidden" }))).error);
    await db.update(s.meetingAreaAccess).set({ accessLevel: "write" }).where(eq(s.meetingAreaAccess.id, grant.id));
    assert.equal(await canConfigureAreaSettings(writer, await current()), true);
    // Revocation during a queued settings save is checked after the area lock.
    let pending: Promise<unknown> | undefined;
    await db.transaction(async tx => {
      await tx.select().from(s.meetingAreas).where(eq(s.meetingAreas.id, area.id)).for("update");
      pending = saveArea(writer, area.id, "Must not be written", "").catch(error => error);
      await tx.delete(s.meetingAreaManagers).where(and(eq(s.meetingAreaManagers.areaId, area.id), eq(s.meetingAreaManagers.userId, writer.id)));
    });
    assert.ok(await pending instanceof Error); assert.equal((await current()).name, "Configured name");
    assert.equal(await canConfigureAreaSettings(writer, await current()), false);
    for (const person of [owner, admin]) assert.equal(await canConfigureAreaSettings(person, await current()), true);
    const trashed = await moveToTrash(owner, "meeting_area", area.id, "LÖSCHEN", { areaName: "Configured name" });
    await assert.rejects(requireArea(groupWriter, area.id, "settings")); await restoreTrashEntry(admin, trashed, "WIEDERHERSTELLEN");
    assert.equal(await canConfigureAreaSettings(groupWriter, await current()), true);
  } finally {
    await purgeTestResource("meeting_area", area.id); await purgeTestResource("meeting_area", other.id);
    await purgeTestResource("board", board.id); await purgeTestResource("board", foreign.id);
    await db.delete(s.groups).where(eq(s.groups.id, group.id)); await db.delete(s.users).where(inArray(s.users.id, people.map(p => p.id)));
    delete context.__areaManagerUser; await rm(temporary, { recursive: true, force: true });
  }
});
