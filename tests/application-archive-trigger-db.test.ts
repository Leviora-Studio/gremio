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
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { setBoardTriggerSources } from "../lib/board-triggers";
import { applyStatusTriggerAssignments, applyTriggerAssignments, getTriggerAssignmentConfigs, setTriggerAssignmentConfig, statusTriggerKinds } from "../lib/trigger-assignments";
import { getApplicationStatusByToken } from "../lib/public-status";
import { insertPublicAttachment } from "../lib/public-workflow";
import { createBoardFromTemplate } from "../lib/boards";
import { serializeBoard, serializeStatus } from "../lib/api";
import { isArchiveTriggerEnabled, isBoardTriggerAvailable, effectiveDoneStatusId } from "../lib/board-trigger-policy";
import { doneSinceForStatus, sweepDoneColumns } from "../lib/done-archive";
import { encryptSecret } from "../lib/crypto";
import { GET as listApiCards } from "../app/api/v1/cards/route";
import { generateApiToken } from "../lib/api-token";

after(() => pool.end());

test("application boards retain Nextcloud archive triggers and disable only Done and retired date triggers", () => {
  const normal = { isApplicationBoard: false, inventoryBoardId: null, doneStatusId: 1 };
  const application = { ...normal, isApplicationBoard: true };
  for (const board of [normal, application]) {
    assert.equal(isBoardTriggerAvailable(board, "instruction"), false);
    assert.equal(isBoardTriggerAvailable(board, "transfer"), false);
    assert.equal(isBoardTriggerAvailable(board, "receipt"), true);
    assert.equal(isArchiveTriggerEnabled(board, { isArchiveTrigger: true }), true);
  }
  assert.equal(isBoardTriggerAvailable(normal, "done"), true);
  assert.equal(isBoardTriggerAvailable(application, "done"), false);
  assert.equal(effectiveDoneStatusId(application), null);
  assert.equal(doneSinceForStatus(effectiveDoneStatusId(application), 1, new Date()), null);
  assert.equal(isArchiveTriggerEnabled({ ...normal, inventoryBoardId: 1 }, { isArchiveTrigger: true }), false);
});

test("application boards inherit/archive to Nextcloud, honor public archive gates and ignore historical Done configuration", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-archive-policy-")), entry = join(output, "archive.cjs");
  // Exercise the real archiver without contacting Nextcloud or reading real files.
  await build({ entryPoints: [join(process.cwd(), "lib/archive.ts")], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "synthetic-nextcloud", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/nextcloud$/ }, () => ({ path: "nextcloud", namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export async function testConnection(){return {ok:true};} export async function uploadAntragArchive(){globalThis.__applicationArchiveCalls++;return "/synthetic/archive";}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths; loaded._compile(await readFile(entry, "utf8"), entry);
  const context = globalThis as unknown as { __applicationArchiveCalls: number }; context.__applicationArchiveCalls = 0;
  const [owner] = await db.insert(s.users).values({ username: `archive-policy-${randomUUID()}`, role: "admin" }).returning();
  const [template] = await db.insert(s.boardTemplates).values({ name: `archive-policy-${randomUUID()}` }).returning();
  await db.insert(s.boardTemplateStatuses).values({ templateId: template.id, name: "Archive", isArchiveTrigger: true });
  const applicationId = await createBoardFromTemplate(owner.id, "Application", null, template.id, { attachmentFields: ["receipts"] });
  const normalId = await createBoardFromTemplate(owner.id, "Normal", null, template.id);
  try {
    const [appStatus] = await db.select().from(s.boardStatuses).where(eq(s.boardStatuses.boardId, applicationId));
    const [normalStatus] = await db.select().from(s.boardStatuses).where(eq(s.boardStatuses.boardId, normalId));
    assert.equal(appStatus.isArchiveTrigger, true);
    assert.equal(normalStatus.isArchiveTrigger, true);
    assert.ok((await setBoardTriggerSources(applicationId, "archive", [appStatus.id])).success);
    assert.ok((await setTriggerAssignmentConfig(applicationId, "archive", false, [owner.id])).success);
    assert.ok((await setTriggerAssignmentConfig(applicationId, "done", true, [])).error);
    await db.update(s.boardStatuses).set({ isInstructionTrigger: true, isTransferTrigger: true, isReceiptTrigger: true }).where(eq(s.boardStatuses.id, appStatus.id));
    await db.update(s.boards).set({ receiptToStatusId: appStatus.id, doneStatusId: appStatus.id, doneSweepTime: "00:00" }).where(eq(s.boards.id, applicationId));
    await db.update(s.boards).set({ doneStatusId: normalStatus.id, doneSweepTime: "00:00" }).where(eq(s.boards.id, normalId));
    await db.insert(s.boardTriggerAssignments).values({ boardId: applicationId, trigger: "done", clearAssignees: true });
    await db.insert(s.boardCardFields).values({ boardId: applicationId, fieldKey: "assignee", visible: true }).onConflictDoUpdate({ target: [s.boardCardFields.boardId, s.boardCardFields.fieldKey], set: { visible: true } });
    const old = new Date("2020-01-01T00:00:00Z");
    const [card] = await db.insert(s.cards).values({ boardId: applicationId, statusId: appStatus.id, title: "Application", applicant: "Synthetic", token: randomUUID(), doneSince: old, deadline: "2020-01-01", instructionDate: "2020-01-02", transferDate: "2020-01-03" }).returning();
    const [normalCard] = await db.insert(s.cards).values({ boardId: normalId, statusId: normalStatus.id, title: "Normal", applicant: "Synthetic", token: randomUUID(), doneSince: old }).returning();
    assert.deepEqual(await statusTriggerKinds(appStatus.id), ["archive"]);
    assert.equal((await getTriggerAssignmentConfigs(applicationId)).has("done"), false);
    await applyStatusTriggerAssignments(card.id, appStatus.id);
    assert.equal((await db.select().from(s.cardAssignees).where(eq(s.cardAssignees.cardId, card.id))).length, 1, "archive assignment remains available");
    await applyTriggerAssignments(card.id, ["done", "instruction", "transfer"]);
    assert.equal((await db.select().from(s.cardAssignees).where(eq(s.cardAssignees.cardId, card.id))).length, 1, "legacy Done assignment is inactive");
    await sweepDoneColumns();
    assert.equal((await db.select().from(s.cards).where(eq(s.cards.id, card.id)))[0].archivedAt, null, "Done sweep must never archive application cards");
    assert.ok((await db.select().from(s.cards).where(eq(s.cards.id, normalCard.id)))[0].archivedAt, "normal Done sweep still works");
    const [board] = await db.select().from(s.boards).where(eq(s.boards.id, applicationId));
    assert.equal((await serializeBoard(board, owner)).doneStatusId, null);
    const token = generateApiToken();
    const [tokenRow] = await db.insert(s.apiTokens).values({ userId: owner.id, name: "Synthetic overdue", tokenHash: token.hash, prefix: token.prefix, scope: "read", restricted: true }).returning();
    await db.insert(s.apiTokenBoards).values({ tokenId: tokenRow.id, boardId: applicationId });
    const overdue = await listApiCards(new Request("http://localhost/api/v1/cards?overdue=true", { headers: { authorization: `Bearer ${token.token}` } }));
    assert.equal(overdue.status, 200);
    assert.ok((await overdue.json()).cards.some((row: { id: number }) => row.id === card.id), "historical Done columns do not hide overdue application cards");
    const view = await getApplicationStatusByToken(card.token);
    assert.equal(view?.archived, true);
    assert.equal(view?.canReceipt, false);
    await assert.rejects(insertPublicAttachment(card.id, "receipt", { filename: "Receipt.pdf", relPath: "synthetic-unread-receipt.pdf", mime: "application/pdf", size: 1 }), /archiviert/);
    await db.update(s.boardArchive).set({ enabled: true, ncUrl: "https://synthetic.invalid", ncUsername: "synthetic", ncPasswordEnc: encryptSecret("synthetic-only"), targetFolder: "/test" }).where(eq(s.boardArchive.boardId, applicationId));
    await loaded.exports.maybeArchive(card.id);
    assert.equal(context.__applicationArchiveCalls, 1);
    const [saved] = await db.select().from(s.cards).where(eq(s.cards.id, card.id));
    assert.equal(saved.nextcloudLink, "/synthetic/archive");
    assert.equal(saved.instructionDate, "2020-01-02"); assert.equal(saved.transferDate, "2020-01-03");
    const exposed = serializeStatus(appStatus, true);
    assert.equal(exposed.isArchiveTrigger, true); assert.equal(exposed.isInstructionTrigger, false); assert.equal(exposed.isTransferTrigger, false);
    assert.equal(board.doneStatusId, appStatus.id, "old Done configuration is retained but inactive");
  } finally {
    await db.delete(s.boards).where(eq(s.boards.id, applicationId));
    await db.delete(s.boards).where(eq(s.boards.id, normalId));
    await db.delete(s.boardTemplates).where(eq(s.boardTemplates.id, template.id));
    await db.delete(s.users).where(eq(s.users.id, owner.id));
    await rm(output, { recursive: true, force: true });
  }
});
