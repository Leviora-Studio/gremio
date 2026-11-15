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
import { canConfigureBoardSettings, canManageBoard } from "../lib/authz";
import { getBoardManagementPeople, setBoardManager } from "../lib/board-management";
import { serializeBoard } from "../lib/api";
import { canManageFinanceBoard } from "../lib/finance";
import { cashbookPermission, requireCashbook } from "../lib/cashbook/access";
import { defaultCashbookConfig } from "../lib/cashbook-types";

after(() => pool.end());

test("limited board managers need live write access, can change only delegated settings and never appoint managers", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-board-management-"));
  const entry = join(output, "actions.cjs");
  const modules = { settings: "actions.ts", locks: "lock-actions.ts", email: "email-actions.ts", management: "management-actions.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), "app/intern/board/[id]/einstellungen", path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__boardManagerUser;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports;
  const context = globalThis as unknown as { __boardManagerUser?: s.User };
  const people = await db.insert(s.users).values(["owner", "writer", "group", "reader", "outsider", "coowner", "admin"].map(key => ({ username: `manager-${key}-${randomUUID()}`, role: key === "admin" ? "admin" as const : "user" as const }))).returning();
  const [owner, writer, groupWriter, reader, outsider, coowner, admin] = people;
  const [board, normal] = await db.insert(s.boards).values([{ name: "Application", ownerId: owner.id, isApplicationBoard: true }, { name: "Normal", ownerId: owner.id }]).returning();
  const [status] = await db.insert(s.boardStatuses).values({ boardId: board.id, name: "Incoming" }).returning();
  const [group] = await db.insert(s.groups).values({ name: `manager-group-${randomUUID()}` }).returning();
  const [finance] = await db.insert(s.financeBoards).values({ ownerId: owner.id, name: "Manager test" }).returning();
  const [cashbook] = await db.insert(s.cashbooks).values({ ownerId: owner.id, name: "Manager test", config: defaultCashbookConfig }).returning();
  const [inventory] = await db.insert(s.inventoryBoards).values({ ownerId: owner.id, name: "Manager inventory" }).returning();
  const [system] = await db.insert(s.boards).values({ ownerId: owner.id, name: "Loans", inventoryBoardId: inventory.id }).returning();
  const form = (values: Record<string, string> = {}) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
  const scope = and(eq(s.boardAccess.boardId, board.id), eq(s.boardAccess.userId, writer.id));
  try {
    await db.insert(s.boardOwners).values({ boardId: board.id, userId: coowner.id });
    await db.insert(s.userGroups).values({ userId: groupWriter.id, groupId: group.id });
    await db.insert(s.boardAccess).values([
      { boardId: board.id, userId: writer.id, accessLevel: "write" },
      { boardId: board.id, userId: groupWriter.id, accessLevel: "read" },
      { boardId: board.id, userId: reader.id, accessLevel: "read" },
      { boardId: board.id, groupId: group.id, accessLevel: "write" },
      { boardId: normal.id, userId: writer.id, accessLevel: "write" },
    ]);
    assert.deepEqual((await getBoardManagementPeople(board.id)).candidates.map(p => p.id).sort(), [writer.id, groupWriter.id].sort());
    for (const person of [writer, groupWriter, reader, outsider]) assert.equal(await canConfigureBoardSettings(person, board), false);
    for (const person of [owner, coowner, admin]) assert.equal(await canConfigureBoardSettings(person, board), true);
    await assert.rejects(setBoardManager(owner, board.id, reader.id, true), /schreibenden Zugriff/);
    await assert.rejects(setBoardManager(writer, board.id, writer.id, true), /Nur Eigentümer/);
    await setBoardManager(coowner, board.id, writer.id, true);
    await setBoardManager(admin, board.id, groupWriter.id, true);
    await setBoardManager(owner, normal.id, writer.id, true);
    assert.equal(await canConfigureBoardSettings(writer, normal), true);
    assert.equal(await canManageBoard(writer, board), false);
    assert.equal((await serializeBoard(board, writer)).role, "member", "delegation never becomes API/MCP ownership");
    await assert.rejects(setBoardManager(writer, board.id, groupWriter.id, false), /Nur Eigentümer/);
    context.__boardManagerUser = writer;
    const denied = [
      () => api.settings.renameBoardAction(board.id, {}, form({ name: "Forbidden" })),
      () => api.settings.deleteBoardConfirmedAction(board.id),
      () => api.settings.setInstructionFormAction(board.id, {}, form()),
      () => api.settings.deleteInstructionFormAction(board.id),
      () => api.settings.saveOfficeRoleAction(board.id, {}, form()),
      () => api.management.setBoardManagerAction(board.id, {}, form({ userId: String(reader.id), operation: "add" })),
    ];
    for (const attempt of denied) await assert.rejects(attempt, /not-found/);
    assert.ok((await api.settings.renameStatusAction(board.id, status.id, {}, form({ name: "Accepted" }))).success);
    const locks = form({ completedStatusId: String(status.id) }); locks.append("statusId", String(status.id));
    assert.ok((await api.locks.saveLockColumnsAction(board.id, {}, locks)).success);
    assert.ok((await api.email.saveBoardEmailRuleAction(board.id, status.id, {}, form({ recipients: "synthetic@example.org", enabled: "on" }))).success);
    await api.settings.addAccessUserAction(board.id, form({ userId: String(outsider.id), accessLevel: "read" }));
    assert.ok((await db.select().from(s.boardAccess).where(and(eq(s.boardAccess.boardId, board.id), eq(s.boardAccess.userId, outsider.id)))).length);
    assert.ok((await api.settings.setCardFieldsAction(board.id, {}, form({ field_notes: "on" }))).success);
    assert.ok((await api.settings.setBoardNumberingAction(board.id, {}, form({ enabled: "on", prefix: "D", next: "7" }))).success);
    assert.ok((await api.settings.setDefaultAccountAction(board.id, {}, form())).success);
    assert.ok((await api.settings.setArchiveConfigAction(board.id, {}, form())).success);
    assert.match((await api.settings.testArchiveAction(board.id, {}, form())).error, /Verbindung speichern/);
    for (const action of ["setResubmitStatusAction", "setReceiptFromStatusAction", "setReceiptToStatusAction", "setArchiveTriggerAction"]) {
      assert.ok((await api.settings[action](board.id, {}, form())).success, action);
    }
    for (const action of ["setDoneColumnAction", "setInstructionTriggerAction", "setTransferTriggerAction"]) {
      assert.ok((await api.settings[action](board.id, {}, form({ statusId: String(status.id) }))).error, action);
    }
    assert.ok((await api.settings.setArchiveTriggerAction(normal.id, {}, form())).success);
    assert.ok((await api.settings.setDoneColumnAction(normal.id, {}, form())).success);
    await api.settings.addStatusAction(normal.id, form({ name: "Delegated column" }));
    assert.equal((await db.select().from(s.boardStatuses).where(eq(s.boardStatuses.boardId, normal.id)))[0].name, "Delegated column");
    await db.update(s.boardAccess).set({ accessLevel: "read" }).where(scope);
    assert.equal(await canConfigureBoardSettings(writer, board), false);
    await assert.rejects(api.settings.renameStatusAction(board.id, status.id, {}, form({ name: "Forbidden" })), /not-found/);
    await assert.rejects(api.email.saveBoardEmailRuleAction(board.id, status.id, {}, form()), /not-found/);
    assert.equal((await getBoardManagementPeople(board.id)).managers.find(p => p.id === writer.id)?.active, false);
    await db.update(s.boardAccess).set({ accessLevel: "write" }).where(scope);
    assert.equal(await canConfigureBoardSettings(writer, board), true);
    assert.equal(await canConfigureBoardSettings(groupWriter, board), true, "group write wins over direct read");
    await db.delete(s.userGroups).where(eq(s.userGroups.userId, groupWriter.id));
    assert.equal(await canConfigureBoardSettings(groupWriter, board), false, "membership revocation applies live");
    await db.update(s.users).set({ isActive: false }).where(eq(s.users.id, writer.id));
    const [inactive] = await db.select().from(s.users).where(eq(s.users.id, writer.id));
    assert.equal(await canConfigureBoardSettings(inactive, board), false);
    await db.update(s.users).set({ isActive: true }).where(eq(s.users.id, writer.id));
    await setBoardManager(owner, board.id, writer.id, false);
    assert.equal(await canConfigureBoardSettings(writer, board), false);
    await db.insert(s.financeBoardAccess).values({ financeBoardId: finance.id, userId: writer.id, accessLevel: "write" });
    await db.insert(s.cashbookAccess).values({ cashbookId: cashbook.id, userId: writer.id, accessLevel: "write" });
    assert.equal(await canManageFinanceBoard(writer, finance), false);
    assert.equal(await cashbookPermission(writer, cashbook), "write");
    await assert.rejects(requireCashbook(writer, cashbook.id, "manage"), /nötigen Rechte/);
    assert.equal(await canConfigureBoardSettings(owner, system), false);
    await assert.rejects(setBoardManager(owner, system.id, writer.id, true), /Nur Eigentümer/);
    await db.insert(s.boardManagers).values({ boardId: system.id, userId: writer.id });
    assert.equal(await canConfigureBoardSettings(writer, system), false, "stale delegation never applies to system boards");
  } finally {
    delete context.__boardManagerUser;
    await db.delete(s.cashbookAccess).where(eq(s.cashbookAccess.cashbookId, cashbook.id));
    await db.delete(s.cashbooks).where(eq(s.cashbooks.id, cashbook.id));
    await db.delete(s.financeBoards).where(eq(s.financeBoards.id, finance.id));
    await db.delete(s.boards).where(inArray(s.boards.id, [board.id, normal.id, system.id]));
    await db.delete(s.inventoryBoards).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.groups).where(eq(s.groups.id, group.id));
    await db.delete(s.users).where(inArray(s.users.id, people.map(person => person.id)));
    await rm(output, { recursive: true, force: true });
  }
});
