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
import {
  accounts, boards, boardStatuses, cards, cardBudgetPositions,
  financeBoards, financeBoardAccess, financeBoardAccounts,
  financeBoardExpenseAccounts, financeBoardSources, financePlanItems,
  users, type User,
} from "../lib/db/schema";
import { loadFinanceData } from "../lib/finance-data";
import { buildFinanceTable } from "../lib/finance-export";

after(() => pool.end());

test("expired source columns exclude only live expenses, with scoped settings and authorization", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/, "isolated test database required");
  const output = await mkdtemp(join(tmpdir(), "gremio-finance-expired-"));
  const entry = join(output, "actions.cjs");
  await build({
    entryPoints: ["app/finanzen/actions.ts"], outfile: entry,
    platform: "node", format: "cjs", bundle: true, packages: "external",
    plugins: [{ name: "request-wrappers", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
      builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
        contents: path === "auth"
          ? 'export async function requireUser(){if(!globalThis.__financeTestUser)throw Error("login");return globalThis.__financeTestUser;} export const requireAdmin = requireUser;'
          : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}',
        loader: "js",
      }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const setExpired = loaded.exports.setFinanceSourceExpiredStatusAction as typeof import("../app/finanzen/actions").setFinanceSourceExpiredStatusAction;
  const context = globalThis as unknown as { __financeTestUser?: User };
  const suffix = `finance-expired-${randomUUID()}`;
  const people = await db.insert(users).values([
    { username: `${suffix}-owner` }, { username: `${suffix}-reader` },
    { username: `${suffix}-admin`, role: "admin" as const },
  ]).returning();
  const [owner, reader, admin] = people;
  const accs = await db.insert(accounts).values(["A", "B"].map(name => ({ name: `${suffix}-${name}` }))).returning();
  const sourceBoards = await db.insert(boards).values(["A", "B"].map(name => ({ name: `${suffix}-${name}`, ownerId: owner.id }))).returning();
  const fbs = await db.insert(financeBoards).values(["A", "B"].map(name => ({ name: `${suffix}-${name}`, ownerId: owner.id }))).returning();
  const [fb, otherFb] = fbs;
  const sourceWhere = and(eq(financeBoardSources.financeBoardId, fb.id), eq(financeBoardSources.boardId, sourceBoards[0].id));
  const form = (status: string) => { const data = new FormData(); data.set("expiredStatusId", status); return data; };
  try {
    const [open, expired, foreign] = await db.insert(boardStatuses).values([
      { boardId: sourceBoards[0].id, name: "Angenommen" },
      { boardId: sourceBoards[0].id, name: "Verfallen" },
      { boardId: sourceBoards[1].id, name: "Verfallen" },
    ]).returning();
    await db.insert(financeBoardSources).values([
      { financeBoardId: fb.id, boardId: sourceBoards[0].id },
      { financeBoardId: fb.id, boardId: sourceBoards[1].id },
      { financeBoardId: otherFb.id, boardId: sourceBoards[0].id },
    ]);
    await db.insert(financeBoardAccounts).values(fbs.flatMap(f => accs.map(a => ({ financeBoardId: f.id, accountId: a.id }))));
    await db.insert(financePlanItems).values(fbs.flatMap(f => ["100", "200"].map(haushaltstitel => ({ financeBoardId: f.id, haushaltstitel, title: haushaltstitel }))));
    await db.insert(financeBoardAccess).values({ financeBoardId: fb.id, userId: reader.id });
    const [single, multi] = await db.insert(cards).values([
      { boardId: sourceBoards[0].id, statusId: expired.id, title: "Expired single", applicant: "Test", token: `${suffix}-single`, accountId: accs[0].id, budgetTitle: "100", approvedAmount: 10000 },
      { boardId: sourceBoards[0].id, statusId: expired.id, title: "Expired positions", applicant: "Test", token: `${suffix}-multi`, budgetMode: "positions" as const, approvedAmount: 60000, actualAmount: 5000 },
      { boardId: sourceBoards[0].id, statusId: open.id, title: "Active", applicant: "Test", token: `${suffix}-active`, accountId: accs[0].id, budgetTitle: "100", approvedAmount: 7000 },
      { boardId: sourceBoards[1].id, statusId: foreign.id, title: "Other source", applicant: "Test", token: `${suffix}-other`, accountId: accs[0].id, budgetTitle: "100", approvedAmount: 3000 },
    ]).returning();
    await db.insert(cardBudgetPositions).values([
      { id: randomUUID(), cardId: multi.id, position: 0, accountId: accs[0].id, budgetTitle: "100", approvedAmount: 20000 },
      { id: randomUUID(), cardId: multi.id, position: 1, accountId: accs[1].id, budgetTitle: "200", approvedAmount: 40000, actualAmount: 5000 },
    ]);
    const before = await loadFinanceData(fb);
    assert.equal(before.live.spentTotal, 45000, "no selection preserves the existing calculation");
    assert.equal(before.actual.spentTotal, 5000);
    assert.equal(before.cardRows.length, 4);
    const originalCards = before.cardRows;
    context.__financeTestUser = reader;
    await assert.rejects(setExpired(fb.id, sourceBoards[0].id, {}, form(String(expired.id))), /not-found/);
    context.__financeTestUser = owner;
    for (const invalid of ["NaN", "-1", "1.5", "2147483648", String(foreign.id)]) {
      assert.ok((await setExpired(fb.id, sourceBoards[0].id, {}, form(invalid))).error);
    }
    assert.equal((await db.select().from(financeBoardSources).where(sourceWhere))[0].expiredStatusId, null);
    assert.ok((await setExpired(otherFb.id, sourceBoards[1].id, {}, form(String(foreign.id)))).error, "board must be a configured source");
    assert.ok((await setExpired(fb.id, sourceBoards[0].id, {}, form(String(expired.id)))).success);
    let data = await loadFinanceData(fb);
    assert.equal(data.live.spentTotal, 10000, "only the selected source column is excluded");
    assert.deepEqual(data.actual, before.actual, "actual position expenses are preserved, including nonzero costs");
    assert.deepEqual(data.cardRows, originalCards, "application rows, amounts and visibility are unchanged");
    assert.equal((await loadFinanceData(otherFb)).live.spentTotal, 42000, "configuration belongs to one finance overview");
    const liveExport = buildFinanceTable("live", data);
    const exportTotal = liveExport.rows.find(row => !Array.isArray(row) && row.style === "total");
    assert.ok(exportTotal && !Array.isArray(exportTotal));
    assert.equal(exportTotal.cells[3], 100, "export uses the filtered live total in euros");
    await db.insert(financeBoardExpenseAccounts).values({ financeBoardId: fb.id, accountId: accs[1].id });
    data = await loadFinanceData(fb);
    assert.equal(data.live.spentTotal, 0);
    assert.equal(data.actual.spentTotal, 5000);
    assert.deepEqual(data.cardRows, originalCards, "expense account override still leaves the overview intact");
    await db.delete(financeBoardExpenseAccounts).where(eq(financeBoardExpenseAccounts.financeBoardId, fb.id));
    await db.update(cards).set({ statusId: open.id }).where(inArray(cards.id, [single.id, multi.id]));
    assert.equal((await loadFinanceData(fb)).live.spentTotal, 45000, "leaving the expired column restores live expenses");
    context.__financeTestUser = admin;
    assert.ok((await setExpired(fb.id, sourceBoards[0].id, {}, form(""))).success);
    assert.equal((await db.select().from(financeBoardSources).where(sourceWhere))[0].expiredStatusId, null, "selection can be cleared");
    assert.ok((await setExpired(fb.id, sourceBoards[0].id, {}, form(String(expired.id)))).success);
    await db.delete(boardStatuses).where(eq(boardStatuses.id, expired.id));
    assert.equal((await db.select().from(financeBoardSources).where(sourceWhere))[0].expiredStatusId, null, "deleting a column clears the selection");
    await db.update(boards).set({ ownerId: reader.id }).where(eq(boards.id, sourceBoards[0].id));
    context.__financeTestUser = owner;
    assert.ok((await setExpired(fb.id, sourceBoards[0].id, {}, form(String(open.id)))).error, "owner must still have live source access");
    assert.equal((await loadFinanceData(fb)).cardRows.length, 1, "revoked source access continues hiding source data");
  } finally {
    delete context.__financeTestUser;
    await db.delete(financeBoards).where(inArray(financeBoards.id, fbs.map(f => f.id)));
    await db.delete(boards).where(inArray(boards.id, sourceBoards.map(b => b.id)));
    await db.delete(accounts).where(inArray(accounts.id, accs.map(a => a.id)));
    await db.delete(users).where(inArray(users.id, people.map(p => p.id)));
    await rm(output, { recursive: true, force: true });
  }
});
