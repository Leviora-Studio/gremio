// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { stageAttachmentTrash, restoreBoardAttachment, boardAttachmentTrash } from "../lib/attachment-trash";
import { moveToTrash, purgeTrashEntry, restoreTrashEntry, sweepTrash } from "../lib/trash";
import { storeApiAttachment, attachmentsApi } from "../lib/api-card-extras";
import { generateApiToken } from "../lib/api-token";
import { getApplicationStatusByToken } from "../lib/public-status";
after(() => pool.end());

test("board file recycle bin preserves bytes/metadata, checks current rights/words and handles slots, locks, missing parents and 30-day purge", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(env.UPLOAD_DIR, /^\/private\/tmp\/gremio-cashbook-test-/);
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const people = await db.insert(s.users).values(["owner", "writer", "reader", "outsider", "admin"].map(role => ({ username: `file-trash-${role}-${randomUUID()}`, role: role === "admin" ? "admin" as const : "user" as const }))).returning();
  const [owner, writer, reader, outsider, admin] = people;
  const [board] = await db.insert(s.boards).values({ name: "File bin", ownerId: owner.id, isApplicationBoard: true }).returning();
  const [foreign] = await db.insert(s.boards).values({ name: "Foreign bin", ownerId: writer.id }).returning();
  await db.insert(s.boardAccess).values([{ boardId: board.id, userId: writer.id, accessLevel: "write" }, { boardId: board.id, userId: reader.id, accessLevel: "read" }]);
  await db.insert(s.boardCardFields).values(["other_pdfs", "finance_request", "number"].map(fieldKey => ({ boardId: board.id, fieldKey, visible: true })));
  const [status] = await db.insert(s.boardStatuses).values({ boardId: board.id, name: "Open" }).returning();
  const [card] = await db.insert(s.cards).values({ boardId: board.id, statusId: status.id, title: "Original card", number: "A-001", applicant: "Synthetic", token: randomUUID() }).returning();
  const [folder] = await db.insert(s.attachmentFolders).values({ cardId: card.id, name: "Documents" }).returning();
  const file = async (kind: "other" | "finance_request" | "student_card" = "other", parent = card.id) => {
    const path = `file-trash-${randomUUID()}.pdf`; await writeFile(join(env.UPLOAD_DIR, path), "original-synthetic-bytes");
    return (await db.insert(s.attachments).values({ cardId: parent, kind, folderId: parent === card.id ? folder.id : null, filename: `Original-${kind}.pdf`, path, mime: "application/pdf", size: 24, uploadedBy: owner.id }).returning())[0];
  };
  const original = await file();
  const originalTimestamp=(await pool.query("select uploaded_at::text as value from attachments where id=$1",[original.id])).rows[0].value;
  const output = await mkdtemp(join(tmpdir(), "gremio-file-trash-actions-")), entry = join(output, "actions.cjs");
  await build({ entryPoints: ["app/intern/card/[id]/actions.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "test-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){return globalThis.__attachmentTrashUser;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module"), loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry);
  const context = globalThis as unknown as { __attachmentTrashUser?: s.User };
  const active = async (id: number) => (await db.select().from(s.attachments).where(eq(s.attachments.id, id)))[0];
  const trashFor = async (id: number) => (await pool.query("select * from trash_entries where kind='attachment' and entity_id=$1 and state in ('trashed','purging')", [id])).rows[0];
  for (const user of [reader, outsider]) { context.__attachmentTrashUser = user; await assert.rejects(loaded.exports.deleteAttachmentAction(card.id, original.id), /not-found/); }
  context.__attachmentTrashUser = writer;
  await loaded.exports.deleteAttachmentAction(card.id, original.id);
  assert.equal(await active(original.id), undefined); assert.equal(await readFile(join(env.UPLOAD_DIR, original.path), "utf8"), "original-synthetic-bytes");
  const trashed = await trashFor(original.id);
  assert.equal(new Date(trashed.expires_at).getTime() - new Date(trashed.deleted_at).getTime(), 30 * 86400000);
  const listed = await boardAttachmentTrash(reader, board.id); assert.equal(listed[0].filename, original.filename); assert.equal(listed[0].cardTitle, card.title); assert.equal(JSON.stringify(listed).includes(original.path), false);
  await assert.rejects(boardAttachmentTrash(outsider, board.id));
  const token = generateApiToken(); await db.insert(s.apiTokens).values({ userId: writer.id, name: "file-trash", tokenHash: token.hash, prefix: token.prefix, scope: "write" });
  const api = await attachmentsApi(new Request("http://localhost/api/v1/cards", { headers: { authorization: `Bearer ${token.token}` } }), String(card.id), String(original.id)); assert.equal(api.status, 404);
  for (const word of [undefined, "", "wiederherstellen", 1]) await assert.rejects(restoreBoardAttachment(writer, board.id, trashed.id, word));
  await assert.rejects(restoreBoardAttachment(reader, board.id, trashed.id, "WIEDERHERSTELLEN"));
  await assert.rejects(restoreBoardAttachment(writer, foreign.id, trashed.id, "WIEDERHERSTELLEN"));
  for (const word of [undefined, "", "endgültig", 1]) await assert.rejects(purgeTrashEntry(writer, trashed.id, word, new Date(), board.id));
  await assert.rejects(purgeTrashEntry(reader, trashed.id, "ENDGÜLTIG", new Date(), board.id));
  await assert.rejects(purgeTrashEntry(writer, trashed.id, "ENDGÜLTIG", new Date(), foreign.id));
  await db.delete(s.boardAccess).where(eq(s.boardAccess.userId,writer.id));
  await assert.rejects(restoreBoardAttachment(writer,board.id,trashed.id,"WIEDERHERSTELLEN"));
  await db.insert(s.boardAccess).values({boardId:board.id,userId:writer.id,accessLevel:"write"});
  await restoreBoardAttachment(writer, board.id, trashed.id, "WIEDERHERSTELLEN"); assert.deepEqual(await active(original.id), original);assert.equal((await pool.query("select uploaded_at::text as value from attachments where id=$1",[original.id])).rows[0].value,originalTimestamp);
  // Restoration never overwrites a newer named-slot file.
  const slot = await file("finance_request"); await db.transaction(tx => stageAttachmentTrash(tx, card.id, slot.id, writer.id));
  const replacement = await file("finance_request"); const slotTrash = await trashFor(slot.id);
  await assert.rejects(restoreBoardAttachment(writer, board.id, slotTrash.id, "WIEDERHERSTELLEN"), /bereits belegt/); assert.deepEqual(await active(replacement.id), replacement);
  await db.transaction(tx => stageAttachmentTrash(tx, card.id, replacement.id, writer.id)); await restoreBoardAttachment(writer, board.id, slotTrash.id, "WIEDERHERSTELLEN");
  // API slot replacement uses the same retention and does not unlink old bytes.
  await storeApiAttachment(card.id, writer.id, "finance_request", new File(["%PDF-synthetic-new"], "New.pdf", { type: "application/pdf" })); assert.ok(await trashFor(slot.id)); await access(join(env.UPLOAD_DIR, slot.path));
  const hidden = await file("student_card"); await db.transaction(tx => stageAttachmentTrash(tx, card.id, hidden.id, owner.id)); const hiddenTrash = await trashFor(hidden.id);
  assert.equal((await boardAttachmentTrash(owner, board.id)).some(row => row.id === hiddenTrash.id), false); await assert.rejects(restoreBoardAttachment(owner, board.id, hiddenTrash.id, "WIEDERHERSTELLEN")); await assert.rejects(purgeTrashEntry(owner, hiddenTrash.id, "ENDGÜLTIG", new Date(), board.id));
  // Deleting the original folder falls back to the card root, preserving bytes.
  await db.transaction(tx => stageAttachmentTrash(tx, card.id, original.id, writer.id)); const repeat = await trashFor(original.id);
  await db.update(s.attachments).set({ folderId: null }).where(eq(s.attachments.cardId, card.id)); await db.delete(s.attachmentFolders).where(eq(s.attachmentFolders.id, folder.id));
  await restoreBoardAttachment(writer, board.id, repeat.id, "WIEDERHERSTELLEN"); assert.equal((await active(original.id)).folderId, null);
  await db.transaction(tx => stageAttachmentTrash(tx, card.id, original.id, writer.id)); const frozenTrash = await trashFor(original.id);
  await db.update(s.cards).set({ lockedAt: new Date(), lockedBy: owner.id }).where(eq(s.cards.id, card.id));
  assert.equal((await boardAttachmentTrash(writer, board.id)).find(row => row.id === frozenTrash.id)?.restorable, false);
  await assert.rejects(restoreBoardAttachment(writer, board.id, frozenTrash.id, "WIEDERHERSTELLEN"), /gesperrt/);
  await purgeTrashEntry(writer, frozenTrash.id, "ENDGÜLTIG", new Date(), board.id); await assert.rejects(access(join(env.UPLOAD_DIR, original.path)));
  // A board in the global bin hides the file bin; restoration preserves entries.
  const boardTrash = await moveToTrash(admin, "board", board.id, "LÖSCHEN", {boardName:board.name}); await assert.rejects(boardAttachmentTrash(writer, board.id)); await restoreTrashEntry(admin, boardTrash, "WIEDERHERSTELLEN"); assert.ok((await boardAttachmentTrash(writer, board.id)).length);
  // Five full days are required; the existing daily sweep also handles files.
  const expiry = new Date((await trashFor(replacement.id)).expires_at); await sweepTrash(new Date(expiry.getTime() - 1)); await access(join(env.UPLOAD_DIR, replacement.path));
  await sweepTrash(new Date(expiry.getTime() + 60000)); await assert.rejects(access(join(env.UPLOAD_DIR, replacement.path))); assert.equal(await active(replacement.id), undefined);
  assert.equal((await getApplicationStatusByToken(card.token))?.documents.some(a => a.id === hidden.id), false);
  const eventTypes=(await db.select({type:s.cardActivity.type}).from(s.cardActivity).where(eq(s.cardActivity.cardId,card.id))).map(row=>row.type);
  for(const type of ["attachment_trashed","attachment_restored","attachment_purged"])assert.ok(eventTypes.includes(type));
  const finalBoard = await moveToTrash(admin, "board", board.id, "LÖSCHEN", {boardName:board.name}); await purgeTrashEntry(admin, finalBoard, "ENDGÜLTIG");
  // Normal boards also retain orphaned files after card deletion and include
  // them in an explicit whole-board purge, even before file expiry.
  const [normalStatus]=await db.insert(s.boardStatuses).values({boardId:foreign.id,name:"Normal"}).returning();
  const [normalCard]=await db.insert(s.cards).values({boardId:foreign.id,statusId:normalStatus.id,title:"Normal source",applicant:"Test",token:randomUUID()}).returning();
  await db.insert(s.boardCardFields).values({boardId:foreign.id,fieldKey:"other_pdfs",visible:true});
  const sharedPath=`shared-trash-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,sharedPath),"shared-bytes");
  const shared=await db.insert(s.attachments).values(["Deleted.pdf","Surviving.pdf"].map(filename=>({cardId:normalCard.id,kind:"other" as const,filename,path:sharedPath,mime:"application/pdf",size:12}))).returning();
  await db.transaction(tx=>stageAttachmentTrash(tx,normalCard.id,shared[0].id,writer.id));await purgeTrashEntry(writer,(await trashFor(shared[0].id)).id,"ENDGÜLTIG",new Date(),foreign.id);await access(join(env.UPLOAD_DIR,sharedPath));
  // Expired restores and interrupted filesystem cleanup are safe and retryable.
  const retryPath=`retry-trash-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,retryPath),"retry-bytes");
  const [retryFile]=await db.insert(s.attachments).values({cardId:normalCard.id,kind:"other",filename:"Retry.pdf",path:retryPath,mime:"application/pdf",size:11}).returning();
  await db.transaction(tx=>stageAttachmentTrash(tx,normalCard.id,retryFile.id,writer.id));const retryTrash=await trashFor(retryFile.id);await rm(join(env.UPLOAD_DIR,retryPath));
  await assert.rejects(restoreBoardAttachment(writer,foreign.id,retryTrash.id,"WIEDERHERSTELLEN"),/Datei fehlt/);
  await mkdir(join(env.UPLOAD_DIR,retryPath));await assert.rejects(purgeTrashEntry(writer,retryTrash.id,"ENDGÜLTIG",new Date(),foreign.id));
  const pending=await trashFor(retryFile.id);assert.equal(pending.state,"purging");assert.ok(pending.last_error);await assert.rejects(restoreBoardAttachment(writer,foreign.id,retryTrash.id,"WIEDERHERSTELLEN"));
  await rm(join(env.UPLOAD_DIR,retryPath),{recursive:true});await writeFile(join(env.UPLOAD_DIR,retryPath),"retry-bytes");await purgeTrashEntry(writer,retryTrash.id,"ENDGÜLTIG",new Date(),foreign.id);await assert.rejects(access(join(env.UPLOAD_DIR,retryPath)));
  const expiredPath=`expired-trash-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,expiredPath),"expiry-bytes");const [expiredFile]=await db.insert(s.attachments).values({cardId:normalCard.id,kind:"other",filename:"Expired.pdf",path:expiredPath,mime:"application/pdf",size:12}).returning();await db.transaction(tx=>stageAttachmentTrash(tx,normalCard.id,expiredFile.id,writer.id));const expiredTrash=await trashFor(expiredFile.id);await pool.query("update trash_entries set deleted_at=now()-interval '744 hours',expires_at=now()-interval '24 hours' where id=$1",[expiredTrash.id]);await assert.rejects(restoreBoardAttachment(writer,foreign.id,expiredTrash.id,"WIEDERHERSTELLEN"),/abgelaufen/);await sweepTrash();await assert.rejects(access(join(env.UPLOAD_DIR,expiredPath)));
  await db.transaction(tx=>stageAttachmentTrash(tx,normalCard.id,shared[1].id,writer.id));const orphan=await trashFor(shared[1].id);await db.delete(s.cards).where(eq(s.cards.id,normalCard.id));
  const orphanRow=(await boardAttachmentTrash(writer,foreign.id)).find(row=>row.id===orphan.id);assert.equal(orphanRow?.cardId,null);assert.equal(orphanRow?.cardTitle,normalCard.title);await assert.rejects(restoreBoardAttachment(writer,foreign.id,orphan.id,"WIEDERHERSTELLEN"),/Karte wurde gelöscht/);
  const normalTrash=await moveToTrash(writer, "board", foreign.id, "LÖSCHEN", {boardName:foreign.name});await purgeTrashEntry(admin,normalTrash,"ENDGÜLTIG");await assert.rejects(access(join(env.UPLOAD_DIR,sharedPath)));assert.equal((await pool.query("select state from trash_entries where id=$1",[orphan.id])).rows[0].state,"purged");
  delete context.__attachmentTrashUser; await rm(output, { recursive: true, force: true });
});
