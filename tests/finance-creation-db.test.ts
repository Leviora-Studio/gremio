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
import { getAccessibleFinanceBoards, canManageFinanceBoard } from "../lib/finance";

after(() => pool.end());

test("only admins create financial overviews; live read access includes owners and direct/group grants", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-finance-creation-")), entry = join(output, "actions.cjs");
  await build({ entryPoints: [join(process.cwd(), "app/finanzen/actions.ts")], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){const u=globalThis.__financeCreationUser;if(!u?.isActive)throw Error("login");return u;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("admin-required");return u;}' : 'export function redirect(path){throw Error("redirect:"+path)} export function notFound(){throw Error("not-found")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const context = globalThis as unknown as { __financeCreationUser?: s.User };
  const people = await db.insert(s.users).values(["admin", "owner", "reader", "writer", "group", "coowner", "outsider", "template"].map(key => ({ username: `finance-create-${key}-${randomUUID()}`, role: key === "admin" ? "admin" as const : key === "template" ? "template_manager" as const : "user" as const }))).returning();
  const [admin, owner, reader, writer, groupReader, coowner, outsider, templateManager] = people;
  const [board] = await db.insert(s.financeBoards).values({ name: "Existing financial overview", ownerId: owner.id }).returning();
  const [group] = await db.insert(s.groups).values({ name: `finance-create-${randomUUID()}` }).returning();
  const [template] = await db.insert(s.financeTemplates).values({ name: `finance-create-${randomUUID()}` }).returning();
  const [top] = await db.insert(s.financeTemplateItems).values({ templateId: template.id, title: "Parent", kind: "expense", haushaltstitel: "1000", plannedAmount: 10000, position: 0 }).returning();
  await db.insert(s.financeTemplateItems).values({ templateId: template.id, parentId: top.id, title: "Child", kind: "expense", haushaltstitel: "1100", plannedAmount: 2500, position: 1 });
  const form = new FormData(); form.set("name", `Admin financial overview ${randomUUID()}`); form.set("templateId", String(template.id));
  form.set("ownerId", String(outsider.id)); form.set("role", "admin");
  let createdId: number | undefined;
  try {
    await db.insert(s.financeBoardAccess).values([{ financeBoardId: board.id, userId: reader.id, accessLevel: "read" }, { financeBoardId: board.id, userId: writer.id, accessLevel: "write" }, { financeBoardId: board.id, groupId: group.id, accessLevel: "read" }]);
    await db.insert(s.userGroups).values({ groupId: group.id, userId: groupReader.id });
    await db.insert(s.financeBoardOwners).values({ boardId: board.id, userId: coowner.id });
    for (const person of [owner, reader, writer, groupReader, coowner]) assert.ok((await getAccessibleFinanceBoards(person)).some(row => row.id === board.id));
    for (const person of [outsider, templateManager]) assert.equal((await getAccessibleFinanceBoards(person)).length, 0);
    assert.equal(await canManageFinanceBoard(owner, board), true, "existing ownership stays valid");
    const before = await db.select({ id: s.financeBoards.id }).from(s.financeBoards);
    for (const person of [owner, reader, writer, groupReader, coowner, outsider, templateManager]) {
      context.__financeCreationUser = person;
      await assert.rejects(loaded.exports.createFinanceBoardAction({}, form), /admin-required/);
    }
    assert.deepEqual(await db.select({ id: s.financeBoards.id }).from(s.financeBoards), before, "denied calls create no records");
    context.__financeCreationUser = { ...admin, isActive: false };
    await assert.rejects(loaded.exports.createFinanceBoardAction({}, form), /login/);
    context.__financeCreationUser = admin;
    await assert.rejects(loaded.exports.createFinanceBoardAction({}, form), /redirect:\/finanzen\/\d+\/einstellungen/);
    const [created] = await db.select().from(s.financeBoards).where(eq(s.financeBoards.name, String(form.get("name"))));
    createdId = created.id;
    assert.equal(created.ownerId, admin.id, "creation uses the authenticated admin, not supplied owner/role fields");
    const positions = await db.select().from(s.financePlanItems).where(eq(s.financePlanItems.financeBoardId, created.id));
    assert.equal(positions.length, 2);
    const copiedTop = positions.find(row => row.title === "Parent")!;
    assert.equal(positions.find(row => row.title === "Child")?.parentId, copiedTop.id);
    assert.equal(copiedTop.plannedAmount, 10000);
    await db.delete(s.userGroups).where(eq(s.userGroups.userId, groupReader.id));
    assert.equal((await getAccessibleFinanceBoards(groupReader)).length, 0, "group revocation removes navigation eligibility");
    await db.delete(s.financeBoardAccess).where(eq(s.financeBoardAccess.userId, reader.id));
    assert.equal((await getAccessibleFinanceBoards(reader)).length, 0, "direct revocation removes navigation eligibility");
    assert.equal((await getAccessibleFinanceBoards({ ...owner, isActive: false })).length, 0);
  } finally {
    delete context.__financeCreationUser;
    if (createdId) await db.delete(s.financeBoards).where(eq(s.financeBoards.id, createdId));
    await db.delete(s.financeBoards).where(eq(s.financeBoards.id, board.id));
    await db.delete(s.financeTemplates).where(eq(s.financeTemplates.id, template.id));
    await db.delete(s.groups).where(eq(s.groups.id, group.id));
    await db.delete(s.users).where(inArray(s.users.id, people.map(person => person.id)));
    await rm(output, { recursive: true, force: true });
  }
});
