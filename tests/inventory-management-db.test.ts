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
import { canConfigureInventorySettings, canManageInventoryBoard } from "../lib/inventory";
import { canConfigureBoardSettings, canManageBoard } from "../lib/authz";
import { getInventoryManagementPeople, setInventoryManager } from "../lib/board-management";
import { serializeBoard } from "../lib/api";

after(() => pool.end());

test("inventory managers can configure exactly the delegated areas and require live direct/group write access", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-inventory-management-")), entry = join(output, "actions.cjs");
  const modules = { settings: "app/intern/inventar/[id]/einstellungen/actions.ts", management: "app/intern/inventar/[id]/einstellungen/management-actions.ts", email: "app/intern/board/[id]/einstellungen/email-actions.ts", board: "app/intern/board/[id]/einstellungen/actions.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__inventoryManagerUser;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports, context = globalThis as unknown as { __inventoryManagerUser?: s.User };
  const people = await db.insert(s.users).values(["owner", "writer", "group", "reader", "outsider", "coowner", "admin"].map(key => ({ username: `inventory-manager-${key}-${randomUUID()}`, role: key === "admin" ? "admin" as const : "user" as const }))).returning();
  const [owner, writer, groupWriter, reader, outsider, coowner, admin] = people;
  const inventories = await db.insert(s.inventoryBoards).values([{ name: "Managed inventory", ownerId: owner.id }, { name: "Other inventory", ownerId: owner.id }]).returning();
  const [inventory, other] = inventories;
  const [loan, unlinked, normal] = await db.insert(s.boards).values([{ name: "Loans", ownerId: owner.id, inventoryBoardId: inventory.id }, { name: "Unlinked system board", ownerId: owner.id, inventoryBoardId: inventory.id }, { name: "Normal board", ownerId: owner.id }]).returning();
  await db.update(s.inventoryBoards).set({ loanBoardId: loan.id }).where(eq(s.inventoryBoards.id, inventory.id));
  const [status, unlinkedStatus] = await db.insert(s.boardStatuses).values([{ boardId: loan.id, name: "Incoming" }, { boardId: unlinked.id, name: "Incoming" }]).returning();
  const [group] = await db.insert(s.groups).values({ name: `inventory-manager-${randomUUID()}` }).returning();
  const form = (values: Record<string, string> = {}) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
  const ownedForm = (values: Record<string, string> = {}) => form({ boardId: String(inventory.id), ...values });
  try {
    await db.insert(s.inventoryBoardOwners).values({ boardId: inventory.id, userId: coowner.id });
    await db.insert(s.userGroups).values({ groupId: group.id, userId: groupWriter.id });
    await db.insert(s.inventoryBoardAccess).values([
      { boardId: inventory.id, userId: writer.id, accessLevel: "write" },
      { boardId: inventory.id, userId: groupWriter.id, accessLevel: "read" },
      { boardId: inventory.id, userId: reader.id, accessLevel: "read" },
      { boardId: inventory.id, groupId: group.id, accessLevel: "write" },
    ]);
    await db.insert(s.boardAccess).values({ boardId: normal.id, userId: writer.id, accessLevel: "write" });
    assert.deepEqual((await getInventoryManagementPeople(inventory.id)).candidates.map(person => person.id).sort(), [writer.id, groupWriter.id].sort());
    for (const person of [owner, coowner, admin]) assert.equal(await canConfigureInventorySettings(person, inventory), true);
    for (const person of [writer, groupWriter, reader, outsider]) assert.equal(await canConfigureInventorySettings(person, inventory), false);
    await assert.rejects(setInventoryManager(owner, inventory.id, reader.id, true), /schreibenden Zugriff/);
    await assert.rejects(setInventoryManager(writer, inventory.id, writer.id, true), /Nur Eigentümer/);
    await setInventoryManager(coowner, inventory.id, writer.id, true);
    await setInventoryManager(admin, inventory.id, groupWriter.id, true);
    assert.equal(await canConfigureInventorySettings(writer, inventory), true);
    assert.equal(await canManageInventoryBoard(writer, inventory), false);
    assert.equal(await canManageBoard(writer, loan), false);
    assert.equal(await canConfigureBoardSettings(writer, normal), false, "inventory delegation does not grant normal board management");
    assert.equal(await canConfigureInventorySettings(writer, other), false);
    assert.equal((await serializeBoard(loan, writer)).role, "member", "REST/MCP ownership stays unchanged");
    context.__inventoryManagerUser = writer;
    const denied = [
      () => api.settings.renameInventoryBoardAction(ownedForm({ name: "Forbidden" })),
      () => api.settings.activateLoanTrackingAction(inventory.id, {}, form()),
      () => api.settings.deactivateLoanTrackingAction(inventory.id, "LÖSCHEN"),
      () => api.settings.deleteInventoryBoardConfirmedAction(inventory.id),
      () => api.management.setInventoryManagerAction(inventory.id, {}, form({ userId: String(reader.id), operation: "add" })),
      () => api.board.addStatusAction(loan.id, form({ name: "Forbidden" })),
      () => api.settings.updateInventoryFieldsAction(form({ boardId: String(other.id) })),
      () => api.email.saveBoardEmailRuleAction(unlinked.id, unlinkedStatus.id, {}, form()),
    ];
    for (const attempt of denied) await assert.rejects(attempt, /not-found/);
    await api.settings.updateInventoryFieldsAction(ownedForm({ visible: "notes" }));
    assert.deepEqual((await db.select().from(s.inventoryBoardFields).where(eq(s.inventoryBoardFields.boardId, inventory.id))).filter(row => row.visible).map(row => row.fieldKey), ["notes"]);
    assert.ok((await api.settings.updateInventoryNumberingAction({}, ownedForm({ enabled: "on", prefix: "INV", padding: "4", next: "12" }))).success);
    assert.equal((await db.select().from(s.inventoryNumbering).where(eq(s.inventoryNumbering.boardId, inventory.id)))[0].prefix, "INV");
    assert.ok((await api.email.saveBoardEmailRuleAction(loan.id, status.id, {}, form({ enabled: "on", recipients: "inventory-test@example.org" }))).success);
    await api.settings.addInventoryAccessUserAction(inventory.id, form({ userId: String(outsider.id), accessLevel: "read" }));
    const [grant] = await db.select().from(s.inventoryBoardAccess).where(and(eq(s.inventoryBoardAccess.boardId, inventory.id), eq(s.inventoryBoardAccess.userId, outsider.id)));
    assert.equal(grant.accessLevel, "read");
    await api.settings.updateInventoryAccessLevelAction(inventory.id, grant.id, form({ accessLevel: "write" }));
    assert.equal(await canConfigureInventorySettings(outsider, inventory), false, "write access alone is not management");
    await api.settings.removeInventoryAccessAction(inventory.id, grant.id);
    await assert.rejects(setInventoryManager(writer, inventory.id, groupWriter.id, false), /Nur Eigentümer/);
    // Group write wins over direct read, but membership changes apply immediately.
    assert.equal(await canConfigureInventorySettings(groupWriter, inventory), true);
    await db.delete(s.userGroups).where(eq(s.userGroups.userId, groupWriter.id));
    assert.equal(await canConfigureInventorySettings(groupWriter, inventory), false);
    assert.equal((await getInventoryManagementPeople(inventory.id)).managers.find(person => person.id === groupWriter.id)?.active, false);
    // A manager can revoke their own content write access, losing settings access.
    const [ownGrant] = await db.select().from(s.inventoryBoardAccess).where(and(eq(s.inventoryBoardAccess.boardId, inventory.id), eq(s.inventoryBoardAccess.userId, writer.id)));
    await api.settings.updateInventoryAccessLevelAction(inventory.id, ownGrant.id, form({ accessLevel: "read" }));
    assert.equal(await canConfigureInventorySettings(writer, inventory), false);
    await assert.rejects(api.settings.updateInventoryFieldsAction(ownedForm()), /not-found/);
    await assert.rejects(api.email.saveBoardEmailRuleAction(loan.id, status.id, {}, form()), /not-found/);
    await db.update(s.inventoryBoardAccess).set({ accessLevel: "write" }).where(eq(s.inventoryBoardAccess.id, ownGrant.id));
    assert.equal(await canConfigureInventorySettings(writer, inventory), true);
    await db.update(s.users).set({ isActive: false }).where(eq(s.users.id, writer.id));
    const [inactive] = await db.select().from(s.users).where(eq(s.users.id, writer.id));
    assert.equal(await canConfigureInventorySettings(inactive, inventory), false);
    await db.update(s.users).set({ isActive: true }).where(eq(s.users.id, writer.id));
    await setInventoryManager(owner, inventory.id, writer.id, false);
    assert.equal(await canConfigureInventorySettings(writer, inventory), false);
    assert.equal((await db.select().from(s.inventoryBoards).where(eq(s.inventoryBoards.id, inventory.id)))[0].name, inventory.name);
  } finally {
    delete context.__inventoryManagerUser;
    await db.update(s.inventoryBoards).set({ loanBoardId: null }).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.boards).where(inArray(s.boards.id, [loan.id, unlinked.id, normal.id]));
    await db.delete(s.inventoryBoards).where(inArray(s.inventoryBoards.id, inventories.map(row => row.id)));
    await db.delete(s.groups).where(eq(s.groups.id, group.id));
    await db.delete(s.users).where(inArray(s.users.id, people.map(person => person.id)));
    await rm(output, { recursive: true, force: true });
  }
});
