// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { restoreTrashEntry, purgeTrashEntry } from "../lib/trash";
import { getBoardById } from "../lib/authz";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { absPath, saveAntragBuffer, saveNamedBuffer } from "../lib/attachments";
import { listLoans } from "../lib/inventory-loans";

after(() => pool.end());

test("tracking board deletion requires typed confirmation and preserves active/old inventory loans and their files", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(resolve(env.UPLOAD_DIR), /^\/private\/tmp\/gremio-cashbook-test-/);
  const output = await mkdtemp(join(tmpdir(), "gremio-loan-tracking-delete-")), entry = join(output, "actions.cjs");
  await build({ entryPoints: [join(process.cwd(), "app/intern/inventar/[id]/einstellungen/actions.ts")], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__trackingDeletionUser;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const context = globalThis as unknown as { __trackingDeletionUser?: s.User };
  const people = await db.insert(s.users).values(["owner", "writer", "reader", "admin"].map(key => ({ username: `tracking-delete-${key}-${randomUUID()}`,role:key==="admin"?"admin" as const:"user" as const }))).returning();
  const [owner, writer, reader, admin] = people;
  const [inventory] = await db.insert(s.inventoryBoards).values({ name: "Tracking deletion test", ownerId: owner.id }).returning();
  const [board] = await db.insert(s.boards).values({ name: "Tracking cards", ownerId: owner.id, inventoryBoardId: inventory.id }).returning();
  const [status] = await db.insert(s.boardStatuses).values({ boardId: board.id, name: "Loans" }).returning();
  await db.update(s.inventoryBoards).set({ loanBoardId: board.id, loanActiveStatusId: status.id }).where(eq(s.inventoryBoards.id, inventory.id));
  const paths: string[] = [];
  try {
    await db.insert(s.inventoryBoardAccess).values([{ boardId: inventory.id, userId: writer.id, accessLevel: "write" }, { boardId: inventory.id, userId: reader.id, accessLevel: "read" }]);
    await db.insert(s.inventoryBoardManagers).values({ boardId: inventory.id, userId: writer.id, grantedById: owner.id });
    const [item] = await db.insert(s.inventoryItems).values({ boardId: inventory.id, name: "Projector", quantity: 2 }).returning();
    const cards = await db.insert(s.cards).values(["Active", "Returned"].map(title => ({ boardId: board.id, statusId: status.id, title, applicant: "Synthetic", token: randomUUID() }))).returning();
    const loans = await db.insert(s.inventoryLoans).values(cards.map((card, index) => ({ itemId: item.id, cardId: card.id, status: index ? "returned" : "active", borrower: card.title, token: randomUUID(), notes: "Stored loan notes", startDate: "2026-01-01", returnedAt: index ? new Date("2026-01-02") : null }))).returning();
    await db.insert(s.inventoryLoanItems).values(loans.map(loan => ({ loanId: loan.id, itemId: item.id, quantity: 1 })));
    await db.insert(s.cardComments).values(cards.map(card => ({ cardId: card.id, userId: owner.id, body: "Tracking-only comment" })));
    await db.insert(s.cardActivity).values(cards.map(card => ({ cardId: card.id, userId: owner.id, type: "created", detail: "Tracking-only activity" })));
    const contract = await saveNamedBuffer(`tracking-delete-${inventory.id}`, "Contract.pdf", Buffer.from("%PDF-synthetic-contract"), "application/pdf"); paths.push(contract.relPath);
    await db.insert(s.inventoryAttachments).values({ itemId: item.id, loanId: loans[0].id, kind: "loan_contract", filename: contract.filename, path: contract.relPath, mime: contract.mime, size: contract.size });
    const cardFile = await saveAntragBuffer(cards[0].id, "Card-only.pdf", Buffer.from("%PDF-synthetic-card-file"), "application/pdf"); paths.push(cardFile.relPath);
    await db.insert(s.attachments).values({ cardId: cards[0].id, kind: "other", filename: cardFile.filename, path: cardFile.relPath, mime: cardFile.mime, size: cardFile.size });
    const inventoryFiles = await db.select().from(s.inventoryAttachments).where(eq(s.inventoryAttachments.itemId, item.id));
    const reservations = await db.select().from(s.inventoryLoanItems).where(eq(s.inventoryLoanItems.itemId, item.id));
    for (const user of [writer, reader]) {
      context.__trackingDeletionUser = user;
      await assert.rejects(loaded.exports.deactivateLoanTrackingAction(inventory.id, "LÖSCHEN"), /not-found/);
    }
    context.__trackingDeletionUser = owner;
    for (const word of [undefined, "", "LOESCHEN", "löschen", "LÖSCHE", 123]) {
      assert.match((await loaded.exports.deactivateLoanTrackingAction(inventory.id, word)).error, /LÖSCHEN/);
      assert.equal((await db.select().from(s.boards).where(eq(s.boards.id, board.id))).length, 1);
    }
    await loaded.exports.deactivateLoanTrackingAction(inventory.id, "LÖSCHEN");
    const kept = await db.select().from(s.inventoryLoans).where(eq(s.inventoryLoans.itemId, item.id)).orderBy(s.inventoryLoans.id);
    assert.deepEqual(kept, loans.map(loan => ({ ...loan, cardId: null })), "both loan records retain all data except their removed card link");
    assert.deepEqual((await listLoans(item.id)).map(loan => loan.id).sort(), loans.map(loan => loan.id).sort(), "active and old loans remain visible at the item");
    assert.deepEqual(await db.select().from(s.inventoryLoanItems).where(eq(s.inventoryLoanItems.itemId, item.id)), reservations);
    assert.deepEqual(await db.select().from(s.inventoryAttachments).where(eq(s.inventoryAttachments.itemId, item.id)), inventoryFiles);
    assert.deepEqual(await readFile(absPath(contract.relPath)), Buffer.from("%PDF-synthetic-contract"));
    assert.deepEqual(await readFile(absPath(cardFile.relPath)),Buffer.from("%PDF-synthetic-card-file"));
    assert.equal(await getBoardById(board.id),undefined);
    assert.equal((await db.select().from(s.cards).where(inArray(s.cards.id,cards.map(card=>card.id)))).length,2);
    const [trash]=await db.select().from(s.trashEntries).where(eq(s.trashEntries.entityId,board.id));
    await restoreTrashEntry(admin,trash.id,"WIEDERHERSTELLEN");
    assert.ok(await getBoardById(board.id));
    assert.equal((await db.select().from(s.inventoryBoards).where(eq(s.inventoryBoards.id,inventory.id)))[0].loanBoardId,board.id);
    assert.deepEqual(await db.select().from(s.inventoryLoans).where(eq(s.inventoryLoans.itemId,item.id)).orderBy(s.inventoryLoans.id),loans);
    await loaded.exports.deactivateLoanTrackingAction(inventory.id,"LÖSCHEN");
    const [secondTrash]=await db.select().from(s.trashEntries).where(eq(s.trashEntries.entityId,board.id)).orderBy(s.trashEntries.id).then(rows=>rows.filter(row=>row.state==="trashed"));
    const [replacement]=await db.insert(s.boards).values({name:"Replacement tracking",ownerId:owner.id,inventoryBoardId:inventory.id}).returning();
    await db.update(s.inventoryBoards).set({loanBoardId:replacement.id}).where(eq(s.inventoryBoards.id,inventory.id));
    await assert.rejects(restoreTrashEntry(admin,secondTrash.id,"WIEDERHERSTELLEN"),/anderes Aufgabentrackingboard/);
    await db.update(s.inventoryBoards).set({loanBoardId:null}).where(eq(s.inventoryBoards.id,inventory.id));
    await db.delete(s.boards).where(eq(s.boards.id,replacement.id));
    await purgeTrashEntry(admin,secondTrash.id,"ENDGÜLTIG");
    await assert.rejects(access(absPath(cardFile.relPath)),{code:"ENOENT"});
    assert.deepEqual(await readFile(absPath(contract.relPath)),Buffer.from("%PDF-synthetic-contract"));
    assert.equal((await db.select().from(s.boards).where(eq(s.boards.id,board.id))).length,0);
    assert.deepEqual(await db.select().from(s.inventoryLoans).where(eq(s.inventoryLoans.itemId,item.id)).orderBy(s.inventoryLoans.id),kept);
  } finally {
    delete context.__trackingDeletionUser;
    await db.update(s.inventoryBoards).set({ loanBoardId: null }).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.boards).where(eq(s.boards.id, board.id));
    await db.delete(s.inventoryBoards).where(eq(s.inventoryBoards.id, inventory.id));
    await db.delete(s.users).where(inArray(s.users.id, people.map(user => user.id)));
    for (const path of paths) await rm(absPath(path), { force: true });
    await rm(output, { recursive: true, force: true });
  }
});
