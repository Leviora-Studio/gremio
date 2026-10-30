// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as schema from "../lib/db/schema";

after(() => pool.end());

test("live person/group access: highest grant wins, readers cannot mutate or elevate privileges", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-access-levels-"));
  const entry = join(output, "actions.cjs");
  const modules = { authz: "lib/authz/index.ts", inventory: "lib/inventory.ts", finance: "lib/finance.ts", card: "app/intern/card/[id]/actions.ts", board: "app/intern/board/actions.ts", folders: "app/intern/card/[id]/attachment-actions.ts", shares: "app/intern/board/[id]/einstellungen/actions.ts", financeActions: "app/finanzen/actions.ts", inventoryShares: "app/intern/inventar/[id]/einstellungen/actions.ts", inventoryItems: "app/intern/inventar/[id]/item-actions.ts", loans: "app/intern/inventar/item/[itemId]/actions.ts", apiAccess: "lib/api-access.ts", apiCards: "lib/api-cards.ts", apiCreate: "app/api/v1/boards/[id]/cards/route.ts", apiCard: "app/api/v1/cards/[id]/route.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){if(!globalThis.__accessTestUser)throw Error("login");return globalThis.__accessTestUser;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("denied");return u;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports;
  const context = globalThis as unknown as { __accessTestUser?: schema.User };
  const name = `access-${randomUUID()}`;
  const [owner, reader, admin, outsider] = await db.insert(schema.users).values([{ username: `${name}-owner` }, { username: `${name}-reader` }, { username: `${name}-admin`, role: "admin" as const }, { username: `${name}-outsider` }]).returning();
  const [readGroup, writeGroup] = await db.insert(schema.groups).values([{ name: `${name}-read` }, { name: `${name}-write` }]).returning();
  await db.insert(schema.userGroups).values([{ userId: reader.id, groupId: readGroup.id }, { userId: reader.id, groupId: writeGroup.id }]);
  const [board] = await db.insert(schema.boards).values({ name, ownerId: owner.id }).returning();
  const [fb] = await db.insert(schema.financeBoards).values({ name, ownerId: owner.id }).returning();
  const [inventory] = await db.insert(schema.inventoryBoards).values({ name, ownerId: owner.id }).returning();
  const [system] = await db.insert(schema.boards).values({ name: `${name}-system`, ownerId: owner.id, inventoryBoardId: inventory.id }).returning();
  const form = (values: Record<string, string>) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
  try {
    const cases = [
      { table: schema.boardAccess, column: schema.boardAccess.boardId, key: "boardId", id: board.id, resource: board, read: api.authz.canAccessBoard, write: api.authz.canEditBoard },
      { table: schema.financeBoardAccess, column: schema.financeBoardAccess.financeBoardId, key: "financeBoardId", id: fb.id, resource: fb, read: api.finance.canAccessFinanceBoard, write: api.finance.canEditFinanceBoard },
      { table: schema.inventoryBoardAccess, column: schema.inventoryBoardAccess.boardId, key: "boardId", id: inventory.id, resource: inventory, read: api.inventory.canAccessInventoryBoard, write: api.inventory.canEditInventoryBoard },
    ];
    for (const c of cases) {
      assert.equal(await c.read(outsider, c.resource), false);
      for (const user of [owner, admin]) assert.equal(await c.write(user, c.resource), true);
      await db.insert(c.table).values({ [c.key]: c.id, userId: reader.id, accessLevel: "read" } as never);
      assert.equal(await c.read(reader, c.resource), true); assert.equal(await c.write(reader, c.resource), false);
      const [groupGrant] = await db.insert(c.table).values({ [c.key]: c.id, groupId: writeGroup.id, accessLevel: "write" } as never).returning();
      await db.insert(c.table).values({ [c.key]: c.id, groupId: readGroup.id, accessLevel: "read" } as never);
      assert.equal(await c.write(reader, c.resource), true, "group write beats direct and group read grants");
      await db.update(c.table).set({ accessLevel: "read" }).where(eq(c.table.id, groupGrant.id));
      assert.equal(await c.write(reader, c.resource), false, "revocation is checked live");
      await db.update(c.table).set({ accessLevel: "write" }).where(eq(c.table.userId, reader.id));
      assert.equal(await c.write(reader, c.resource), true, "direct write beats group read");
      await db.update(c.table).set({ accessLevel: "read" }).where(eq(c.column, c.id));
    }
    assert.equal(await api.authz.canAccessBoard(reader, system), true);
    assert.equal(await api.authz.canEditBoard(reader, system), false);
    const [status] = await db.insert(schema.boardStatuses).values({ boardId: board.id, name: "Open" }).returning();
    const [target] = await db.insert(schema.boardStatuses).values({ boardId: board.id, name: "Closed" }).returning();
    const [card] = await db.insert(schema.cards).values({ boardId: board.id, statusId: status.id, title: "Original", applicant: "Test", token: randomUUID() }).returning();
    const [item] = await db.insert(schema.inventoryItems).values({ boardId: inventory.id, name: "Original" }).returning();
    context.__accessTestUser = reader;
    await assert.rejects(api.card.saveCardAction(card.id, { title: "Denied" }), /not-found/);
    await assert.rejects(api.card.setCardStatusAction(card.id, target.id), /nicht erlaubt/);
    await assert.rejects(api.card.addCommentAction(card.id, {}, form({ body: "Denied" })), /not-found/);
    await assert.rejects(api.card.saveBudgetPositionsAction(card.id, [], 0), /not-found/);
    await assert.rejects(api.card.deleteCardAction(card.id), /not-found/);
    await assert.rejects(api.folders.createAttachmentFolderAction(card.id, {}, form({ name: "Denied" })), /not-found/);
    await assert.rejects(api.board.moveCardAction(card.id, target.id, [card.id]), /nicht erlaubt/);
    assert.ok((await api.board.createBlankCardAction(board.id)).error);
    await assert.rejects(api.financeActions.addPlanItemAction(fb.id, null), /not-found/);
    assert.ok((await api.inventoryItems.createInventoryItemAction({}, form({ boardId: String(inventory.id), name: "Denied" }))).error);
    await assert.rejects(api.loans.createLoanAction(form({ itemId: String(item.id), borrower: "Denied" })), /Kein Zugriff/);
    for (const [action, id] of [[api.shares.addAccessUserAction, board.id], [api.financeActions.addFinanceAccessUserAction, fb.id], [api.inventoryShares.addInventoryAccessUserAction, inventory.id]]) {
      await assert.rejects(action(id, form({ userId: String(outsider.id), accessLevel: "write" })), /not-found/);
    }
    const [grant] = await db.select().from(schema.financeBoardAccess).where(eq(schema.financeBoardAccess.userId, reader.id));
    await assert.rejects(api.financeActions.updateFinanceAccessLevelAction(fb.id, grant.id, form({ accessLevel: "write" })), /not-found/);
    const [unchanged] = await db.select().from(schema.cards).where(eq(schema.cards.id, card.id));
    assert.equal(unchanged.title, "Original"); assert.equal(unchanged.statusId, status.id);
    const token = `grm_${randomUUID().replaceAll("-", "")}`;
    const { createHash } = await import("node:crypto");
    await db.insert(schema.apiTokens).values({ userId: reader.id, name: "Synthetic", tokenHash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 11), scope: "write" });
    const request = (method: string) => new Request("http://localhost/api/v1/test", { method, headers: { authorization: `Bearer ${token}` } });
    assert.equal((await api.apiAccess.resolveApiBoard(request("GET"), String(board.id))).board.id, board.id);
    for (const response of [await api.apiAccess.resolveApiBoard(request("POST"), String(board.id), true), await api.apiAccess.resolveApiCard(request("PATCH"), String(card.id), true), await api.apiCreate.POST(request("POST"), { params: Promise.resolve({ id: String(board.id) }) }), await api.apiCard.PATCH(request("PATCH"), { params: Promise.resolve({ id: String(card.id) }) }), await api.apiCard.DELETE(request("DELETE"), { params: Promise.resolve({ id: String(card.id) }) })]) assert.equal(response.status, 403);
    context.__accessTestUser = owner;
    const officeForm = (id: number, sources = [status.id], targets = [target.id]) => {
      const f = form({ enabled: "on", userId: String(id) });
      sources.forEach(value => f.append("sourceStatusIds", String(value)));
      targets.forEach(value => f.append("targetStatusIds", String(value)));
      return f;
    };
    assert.ok((await api.shares.saveOfficeRoleAction(board.id, {}, officeForm(outsider.id))).error, "office selection never grants read access");
    assert.ok((await api.shares.saveOfficeRoleAction(board.id, {}, officeForm(reader.id, [], [target.id]))).error);
    const [foreignStatus] = await db.insert(schema.boardStatuses).values({ boardId: system.id, name: "Foreign" }).returning();
    assert.ok((await api.shares.saveOfficeRoleAction(board.id, {}, officeForm(reader.id, [status.id], [foreignStatus.id]))).error);
    assert.ok((await api.shares.saveOfficeRoleAction(board.id, {}, officeForm(reader.id))).success);
    await assert.rejects(db.insert(schema.boardOfficeStatuses).values({ boardId: board.id, statusId: foreignStatus.id, direction: "target" }), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23503", "database foreign key rejects cross-board status permissions");
    assert.equal(await api.authz.canEditBoard(reader, board), false);
    assert.equal(await api.authz.canMoveBoardCard(reader, board, card, target.id), true);
    assert.equal(await api.authz.canMoveBoardCard(reader, board, card, status.id), false);
    assert.equal(await api.authz.canMoveBoardCard(reader, board, { ...card, archivedAt: new Date() }, target.id), false);
    context.__accessTestUser = reader;
    await assert.rejects(api.card.saveCardAction(card.id, { title: "Still denied" }), /not-found/);
    await assert.rejects(api.card.addCommentAction(card.id, {}, form({ body: "Still denied" })), /not-found/);
    await assert.rejects(api.card.deleteCardAction(card.id), /not-found/);
    await assert.rejects(api.folders.createAttachmentFolderAction(card.id, {}, form({ name: "Still denied" })), /not-found/);
    const jsonPatch = (data: object) => new Request("http://localhost/api/v1/test", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(data) });
    assert.equal((await api.apiCard.PATCH(jsonPatch({ statusId: target.id, title: "Denied" }), { params: Promise.resolve({ id: String(card.id) }) })).status, 403);
    assert.equal((await api.apiCard.PATCH(jsonPatch({ statusId: target.id }), { params: Promise.resolve({ id: String(card.id) }) })).status, 200);
    assert.equal((await api.apiCard.PATCH(jsonPatch({ statusId: status.id }), { params: Promise.resolve({ id: String(card.id) }) })).status, 403);
    const stale = await api.apiCards.updateCardViaApi(reader, board, card, { statusId: target.id });
    assert.equal(stale.status, 403, "fresh locked source prevents stale-source permission bypass");
    await assert.rejects(api.card.setCardStatusAction(card.id, status.id), /nicht erlaubt/);
    await db.update(schema.cards).set({ statusId: status.id }).where(eq(schema.cards.id, card.id));
    await api.card.setCardStatusAction(card.id, target.id);
    assert.equal((await db.select().from(schema.cards).where(eq(schema.cards.id, card.id)))[0].statusId, target.id);
    const [peer] = await db.insert(schema.cards).values({ boardId: board.id, statusId: target.id, title: "Peer", applicant: "Test", token: randomUUID(), position: 0 }).returning();
    await db.update(schema.cards).set({ statusId: status.id }).where(eq(schema.cards.id, card.id));
    await api.board.moveCardAction(card.id, target.id, [card.id, peer.id]);
    const ordered = await db.select().from(schema.cards).where(eq(schema.cards.statusId, target.id)).orderBy(schema.cards.position);
    assert.deepEqual(ordered.map(c => c.id), [peer.id, card.id], "office moves append without rearranging other cards");
    await db.delete(schema.boardAccess).where(eq(schema.boardAccess.userId, reader.id));
    await db.delete(schema.userGroups).where(eq(schema.userGroups.userId, reader.id));
    assert.equal(await api.authz.canAccessBoard(reader, board), false);
    assert.equal(await api.authz.canMoveBoardCard(reader, board, card, target.id), false, "office role cannot preserve revoked read access");
    await db.insert(schema.boardAccess).values({ boardId: board.id, userId: reader.id, accessLevel: "read" });
    await db.insert(schema.userGroups).values([{ userId: reader.id, groupId: readGroup.id }, { userId: reader.id, groupId: writeGroup.id }]);
    context.__accessTestUser = owner;
    await api.shares.addAccessGroupAction(board.id, form({ groupId: String(writeGroup.id), accessLevel: "write" }));
    assert.equal(await api.authz.canEditBoard(reader, board), true, "group write grant overrides office restrictions");
    assert.equal(await api.authz.canMoveBoardCard(reader, board, { ...card, statusId: target.id }, status.id), true);
    await api.shares.addAccessGroupAction(board.id, form({ groupId: String(writeGroup.id), accessLevel: "read" }));
    await api.shares.saveOfficeRoleAction(board.id, {}, new FormData());
    assert.equal(await api.authz.canMoveBoardCard(reader, board, card, target.id), false, "disabling office removes the extra movement permission");
    await api.shares.addAccessUserAction(board.id, form({ userId: String(reader.id), accessLevel: "write" }));
    assert.equal(await api.authz.canEditBoard(reader, board), true);
    await api.shares.addAccessUserAction(board.id, form({ userId: String(reader.id), accessLevel: "invalid" }));
    assert.equal(await api.authz.canEditBoard(reader, board), true, "invalid grant updates are ignored");
    await api.financeActions.addFinanceAccessGroupAction(fb.id, form({ groupId: String(writeGroup.id), accessLevel: "write" }));
    context.__accessTestUser = reader;
    assert.ok((await api.card.saveCardAction(card.id, { title: "Allowed" })).ok);
    await api.financeActions.addPlanItemAction(fb.id, null);
    assert.equal((await db.select().from(schema.financePlanItems).where(eq(schema.financePlanItems.financeBoardId, fb.id))).length, 1);
    await assert.rejects(api.financeActions.updateFinanceAccessLevelAction(fb.id, grant.id, form({ accessLevel: "write" })), /not-found/, "writers cannot manage sharing");
  } finally {
    delete context.__accessTestUser;
    await db.delete(schema.boards).where(eq(schema.boards.id, system.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, board.id));
    await db.delete(schema.financeBoards).where(eq(schema.financeBoards.id, fb.id));
    await db.delete(schema.inventoryBoards).where(eq(schema.inventoryBoards.id, inventory.id));
    for (const user of [owner, reader, admin, outsider]) await db.delete(schema.users).where(eq(schema.users.id, user.id));
    for (const group of [readGroup, writeGroup]) await db.delete(schema.groups).where(eq(schema.groups.id, group.id));
    await rm(output, { recursive: true, force: true });
  }
});
