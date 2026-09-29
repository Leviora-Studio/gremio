// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { attachmentFolders, attachments, boardAccess, boardCardFields, boards, boardStatuses, cards, users, type User } from "../lib/db/schema";

after(() => pool.end());

test("internal folder actions enforce board membership, visibility, card boundaries and safe renames", async () => {
  const database = new URL(process.env.DATABASE_URL!).pathname;
  assert.match(database, /^\/gremio_workflows_test_/, "only an isolated test database is allowed");
  const output = await mkdtemp(join(tmpdir(), "gremio-folder-actions-"));
  // Only Next request/session/cache wrappers are doubled. Real actions,
  // authorization, visibility checks, transactions and constraints execute.
  const entry = join(output, "actions.cjs");
  await build({ entryPoints: ["app/intern/card/[id]/attachment-actions.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-wrappers", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){if(!globalThis.__folderTestUser)throw Error("login");return globalThis.__folderTestUser;}' : 'export function notFound(){throw Error("not-found")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  // Resolve bundled external packages from the repository's existing runtime.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const loaded = new Module(entry, module);
  loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await (await import("node:fs/promises")).readFile(entry, "utf8"), entry);
  const { createAttachmentFolderAction: createFolder, organizeAttachmentAction: organize } = loaded.exports;
  const context = globalThis as unknown as { __folderTestUser?: User };
  const suffix = `folders-${randomUUID()}`;
  const [owner, member, outsider] = await db.insert(users).values(["owner", "member", "outsider"].map((name) => ({ username: `${suffix}-${name}` }))).returning();
  const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning();
  const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
  try {
    const [status] = await db.insert(boardStatuses).values({ boardId: board.id, name: "Open" }).returning();
    await db.insert(boardAccess).values({ boardId: board.id, userId: member.id });
    await db.insert(boardCardFields).values({ boardId: board.id, fieldKey: "other_pdfs", visible: true });
    const [card, foreignCard] = await db.insert(cards).values(["one", "two"].map((name) => ({ boardId: board.id, statusId: status.id, title: name, applicant: "Test", token: `${suffix}-${name}` }))).returning();
    const [att, hidden] = await db.insert(attachments).values(["other", "student_card"].map((kind) => ({ cardId: card.id, kind: kind as "other" | "student_card", filename: "Original.pdf", path: "synthetic-not-read", mime: "application/pdf", size: 1 }))).returning();
    await assert.rejects(createFolder(card.id, {}, form({ name: "Denied" })), /login/);
    context.__folderTestUser = outsider;
    await assert.rejects(createFolder(card.id, {}, form({ name: "Denied" })), /not-found/);
    context.__folderTestUser = member;
    assert.ok((await createFolder(card.id, {}, form({ name: "Belege" }))).success);
    assert.ok((await createFolder(card.id, {}, form({ name: "belege" }))).error);
    assert.ok((await createFolder(card.id, {}, form({ name: "../escape" }))).error);
    const results = await Promise.all([createFolder(card.id, {}, form({ name: "Parallel" })), createFolder(card.id, {}, form({ name: "Parallel" }))]);
    assert.equal(results.filter((r: { success?: string }) => r.success).length, 1);
    const [folder] = await db.select().from(attachmentFolders).where(eq(attachmentFolders.cardId, card.id));
    const [foreign] = await db.insert(attachmentFolders).values({ cardId: foreignCard.id, name: "Foreign" }).returning();
    assert.ok((await organize(card.id, att.id, {}, form({ filename: "Receipt.pdf", folderId: String(foreign.id) }))).error);
    assert.ok((await organize(card.id, hidden.id, {}, form({ filename: "Hidden.pdf", folderId: String(folder.id) }))).error);
    assert.ok((await organize(card.id, att.id, {}, form({ filename: "Receipt.html", folderId: String(folder.id) }))).error);
    const fresh = async () => (await db.select().from(attachments).where(eq(attachments.id, att.id)))[0];
    assert.deepEqual(await fresh(), att, "rejected mutations preserve the attachment");
    assert.ok((await organize(card.id, att.id, {}, form({ filename: "Receipt.pdf", folderId: String(folder.id) }))).success);
    assert.equal((await fresh()).filename, "Receipt.pdf"); assert.equal((await fresh()).folderId, folder.id);
    assert.equal((await fresh()).path, att.path, "organizing never changes stored bytes or paths");
    await assert.rejects(db.update(attachments).set({ folderId: foreign.id }).where(eq(attachments.id, att.id)), (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23503");
    assert.ok((await organize(card.id, att.id, {}, form({ filename: "Receipt.pdf", folderId: "" }))).success);
    assert.equal((await fresh()).folderId, null);
    assert.ok((await organize(card.id, att.id, {}, form({ filename: "Stale.pdf", folderId: "", originalFilename: "Original.pdf", originalFolderId: "" }))).error, "stale forms do not overwrite another rename");
    const legacyName = `${"x".repeat(125)}.pdf`;
    await db.update(attachments).set({ filename: legacyName }).where(eq(attachments.id, att.id));
    assert.ok((await organize(card.id, att.id, {}, form({ filename: legacyName, folderId: String(folder.id) }))).success, "moving a legacy filename does not require a rename");
    await db.update(attachments).set({ folderId: folder.id }).where(eq(attachments.id, att.id));
    await db.delete(cards).where(eq(cards.id, card.id));
    assert.equal((await db.select().from(attachmentFolders).where(eq(attachmentFolders.cardId, card.id))).length, 0);
  } finally {
    delete context.__folderTestUser;
    await db.delete(boards).where(eq(boards.id, board.id));
    for (const person of [owner, member, outsider]) await db.delete(users).where(eq(users.id, person.id));
    await rm(output, { recursive: true, force: true });
  }
});
