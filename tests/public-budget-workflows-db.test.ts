import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { accounts, attachments, boards, boardStatuses, cardBudgetPositions, cards, users, boardCardFields, boardTemplates, boardTemplateStatuses, financeBoards, financeBoardAccounts, financeBoardExpenseAccounts, financeBoardSources, financePlanItems } from "../lib/db/schema";
import { createBoardFromTemplate } from "../lib/boards";
import { BUDGET_FIELDS, type BudgetPosition } from "../lib/card-budget";
import { guardBudgetCardUpdate, loadBudgetPositions, writeBudgetPositions } from "../lib/card-budget-db";
import { getApplicationStatusByToken } from "../lib/public-status";
import { insertPublicAttachment, submitPublicWorkflow, publicGates, storePublicAttachment } from "../lib/public-workflow";
import { setBoardTriggerSources } from "../lib/board-triggers";
import { buildFinanceTable } from "../lib/finance-export";
import { updateCardViaApi } from "../lib/api-cards";
import { loadFinanceData } from "../lib/finance-data";
import { MAX_PUBLIC_OTHER_FILES } from "../lib/constants";
import { nextReceiptIndex, receiptFileName } from "../lib/attachments";
after(() => pool.end());

test("atomic multi-account budgets, public sums, account-specific expenses, guarded writes and lossless transitions", async () => {
  const suffix = `budget-test-${randomUUID()}`;
  const [owner] = await db.insert(users).values({ username: suffix, role: "admin" }).returning();
  const accs = await db.insert(accounts).values([{ name: `${suffix}-A` }, { name: `${suffix}-B` }]).returning();
  const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning();
  let financeId: number | undefined;
  try {
    const [status] = await db.insert(boardStatuses).values({ boardId: board.id, name: "Open" }).returning();
    const visible = new Set(Object.values(BUDGET_FIELDS));
    await db.insert(boardCardFields).values([...visible].map(fieldKey => ({ boardId: board.id, fieldKey, visible: true })));
    const [initial] = await db.insert(cards).values({ boardId: board.id, statusId: status.id, title: suffix, applicant: "Test", token: suffix, budgetTitle: "12345", accountId: accs[0].id, requestedAmount: 20000, approvedAmount: 15000, actualAmount: 13000 }).returning();
    const fresh = async () => (await db.select().from(cards).where(eq(cards.id, initial.id)))[0];
    const put = async (rows: BudgetPosition[], revision?: number, fields: Set<string> = visible) => db.transaction(async tx => {
      const card = await guardBudgetCardUpdate(tx, initial.id, {});
      return writeBudgetPositions(tx, card, rows, revision ?? card.budgetRevision, fields);
    });
    const a: BudgetPosition = { id: randomUUID(), budgetTitle: "12345", description: "Gegenstand A", accountId: accs[0].id, requestedAmount: 20000, approvedAmount: 15000, actualAmount: 13000 };
    const b: BudgetPosition = { id: randomUUID(), budgetTitle: "12344", description: "Gegenstand B", accountId: accs[1].id, requestedAmount: 20000, approvedAmount: 20000, actualAmount: 18000 };
    await assert.rejects(put([a, { ...b, accountId: null as unknown as number }]));
    assert.equal((await fresh()).budgetMode, "single"); assert.equal((await loadBudgetPositions(initial.id)).length, 0);
    const editedFirst = { ...a, budgetTitle: "54321", accountId: accs[1].id, requestedAmount: 21000, approvedAmount: 16000, actualAmount: 14000 };
    await assert.rejects(put([editedFirst, b], undefined, new Set(["budget_title", "account", "requested_amount", "actual_amount"])), /aktiviert/, "hidden fields stay protected during initial transition");
    await assert.rejects(put([editedFirst, { ...b, accountId: null as unknown as number }]));
    assert.deepEqual(await fresh(), initial, "incomplete transition preserves every original card value");
    const transition = await updateCardViaApi(owner, board, initial, { budgetPositions: [editedFirst, b], budgetRevision: initial.budgetRevision });
    assert.equal(transition.ok, true, "initial transition accepts edits to all visible prefilled fields");
    const transitioned = await fresh();
    assert.deepEqual([transitioned.requestedAmount, transitioned.approvedAmount, transitioned.actualAmount], [41000, 36000, 32000]);
    const loadedFirst = (await loadBudgetPositions(initial.id))[0];
    assert.equal(loadedFirst.budgetTitle, "54321"); assert.equal(loadedFirst.accountId, accs[1].id);
    await put([a, b]);
    const multi = await fresh();
    assert.equal(multi.budgetMode, "positions"); assert.equal(multi.accountId, null); assert.equal(multi.budgetTitle, null);
    assert.deepEqual([multi.requestedAmount, multi.approvedAmount, multi.actualAmount], [40000, 35000, 31000]);
    const publicStatus = await getApplicationStatusByToken(suffix);
    assert.equal(publicStatus?.approvedAmountCents, 35000);
    assert.equal("accountId" in publicStatus!, false); assert.equal("budgetPositions" in publicStatus!, false);
    for (const input of [{ approvedAmountCents: 1 }, { accountId: accs[0].id }, { budgetTitle: "override" }]) {
      const result = await updateCardViaApi(owner, board, multi, input);
      assert.equal(result.ok, false);
    }
    await assert.rejects(put([a, b], 0), /inzwischen/);
    await assert.rejects(put([{ ...a, approvedAmount: 1 }, b], undefined, new Set(["budget_title", "account", "requested_amount", "actual_amount"])), /aktiviert/);
    const hiddenAmounts = [a, b].map(({ approvedAmount: _approved, ...row }) => row);
    const partial = await updateCardViaApi(owner, board, await fresh(), { budgetPositions: hiddenAmounts, budgetRevision: (await fresh()).budgetRevision });
    assert.equal(partial.ok, true); assert.equal((await fresh()).approvedAmount, 35000);
    await assert.rejects(db.delete(accounts).where(eq(accounts.id, accs[0].id)));
    const [fb] = await db.insert(financeBoards).values({ name: suffix, ownerId: owner.id }).returning(); financeId = fb.id;
    await db.insert(financeBoardSources).values({ financeBoardId: fb.id, boardId: board.id });
    await db.insert(financeBoardAccounts).values(accs.map(account => ({ financeBoardId: fb.id, accountId: account.id })));
    await db.insert(financePlanItems).values([{ haushaltstitel: "12345", title: "A" }, { haushaltstitel: "12344", title: "B" }].map((r, position) => ({ ...r, financeBoardId: fb.id, kind: "expense" as const, position })));
    let data = await loadFinanceData(fb);
    assert.equal(data.cardRows.length, 1); assert.equal(data.cardRows[0].budgetTitle, "12345, 12344"); assert.equal(data.actual.spentTotal, 31000);
    const exported = buildFinanceTable("antraege", data);
    assert.equal(exported.rows.filter((r) => (Array.isArray(r) ? r : r.cells).includes(suffix)).length, 1);
    await db.insert(financeBoardExpenseAccounts).values({ financeBoardId: fb.id, accountId: accs[0].id });
    data = await loadFinanceData(fb);
    assert.equal(data.cardRows[0].approvedAmount, 35000); assert.equal(data.actual.spentTotal, 13000);
    await put([{ ...a, actualAmount: null }, b]);
    data = await loadFinanceData(fb);
    assert.equal(data.live.spentTotal, 15000); assert.equal(data.actual.spentTotal, 0);
    await db.delete(financeBoardExpenseAccounts).where(eq(financeBoardExpenseAccounts.financeBoardId, fb.id));
    await db.delete(financeBoardAccounts).where(eq(financeBoardAccounts.accountId, accs[0].id));
    data = await loadFinanceData(fb);
    assert.equal(data.cardRows.length, 1); assert.equal(data.cardRows[0].approvedAmount, 35000); assert.equal(data.actual.spentTotal, 18000);
    await put([b]); assert.equal((await fresh()).budgetMode, "positions", "description must survive");
    await put([{ ...b, description: null }]);
    const single = await fresh(); assert.equal(single.budgetMode, "single"); assert.equal(single.accountId, accs[1].id); assert.equal(single.budgetTitle, "12344"); assert.equal(single.actualAmount, 18000);
    assert.equal((await loadBudgetPositions(initial.id)).length, 0);
  } finally {
    if (financeId) await db.delete(financeBoards).where(eq(financeBoards.id, financeId));
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(accounts).where(inArray(accounts.id, accs.map(a => a.id)));
    await db.delete(users).where(eq(users.id, owner.id));
  }
});

test("public gates overlap; parallel receipts have unique names, general names survive, archive wins and quota is atomic", async () => {
  const suffix = `public-workflow-${randomUUID()}`;
  const [owner] = await db.insert(users).values({ username: suffix }).returning();
  const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning();
  try {
    const statuses = await db.insert(boardStatuses).values([0,1,2,3].map(position => ({ boardId: board.id, name: String(position), position, isReceiptTrigger: position < 3 }))).returning();
    assert.ok((await setBoardTriggerSources(board.id, "receipt", [2147483647])).error);
    assert.ok((await setBoardTriggerSources(board.id, "receipt", [statuses[0].id, statuses[0].id, statuses[1].id, statuses[2].id])).success);
    assert.ok((await setBoardTriggerSources(board.id, "archive", statuses.map(s => s.id))).success);
    assert.equal((await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, board.id))).filter(s => s.isArchiveTrigger).length, 4);
    await setBoardTriggerSources(board.id, "archive", []);
    await db.update(boards).set({ receiptToStatusId: statuses[3].id, resubmitStatusId: statuses[0].id }).where(eq(boards.id, board.id));
    const [card] = await db.insert(cards).values({ boardId: board.id, statusId: statuses[0].id, title: suffix, applicant: "Test", token: suffix, number: "2026_1", approvedAmount: 0 }).returning();
    let view = await getApplicationStatusByToken(suffix);
    assert.equal(view?.canReceipt, true); assert.equal(view?.canResubmit, true); assert.equal(view?.approvedAmountCents, 0);
    const upload = (purpose: "general" | "receipt" | "resubmission", name = "Original.pdf") => insertPublicAttachment(card.id, purpose, { filename: name, relPath: `test-only/${randomUUID()}`, mime: "application/pdf", size: 10 });
    assert.equal(await upload("general"), "Original.pdf"); assert.equal(await upload("resubmission", "Nachtrag.pdf"), "Nachtrag.pdf");
    const names = await Promise.all([upload("receipt"), upload("receipt"), upload("receipt")]);
    assert.deepEqual(names.sort(), ["2026_1_Q1.pdf", "2026_1_Q2.pdf", "2026_1_Q3.pdf"]);
    assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].resubmittedAt, null);
    await submitPublicWorkflow(card.id, "resubmission");
    assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].statusId, statuses[0].id);
    await submitPublicWorkflow(card.id, "receipt");
    await assert.rejects(upload("receipt"), /freigeschaltet/);
    for (const status of statuses.slice(0,3)) { await db.update(cards).set({ statusId: status.id }).where(eq(cards.id, card.id)); view = await getApplicationStatusByToken(suffix); assert.equal(view?.canReceipt, true); }
    await db.update(cards).set({ statusId: statuses[0].id }).where(eq(cards.id, card.id));
    await db.update(boardStatuses).set({ isArchiveTrigger: true }).where(eq(boardStatuses.id, statuses[0].id));
    view = await getApplicationStatusByToken(suffix); assert.equal(view?.canReceipt, false); assert.equal(view?.canResubmit, false); assert.equal(view?.canUploadDocuments, false);
    await assert.rejects(upload("general"), /archiviert/); await assert.rejects(submitPublicWorkflow(card.id, "receipt"), /archiviert/);
    await db.update(boardStatuses).set({ isArchiveTrigger: false }).where(eq(boardStatuses.id, statuses[0].id));
    const outcomes = await Promise.allSettled(Array.from({ length: MAX_PUBLIC_OTHER_FILES }, () => upload("receipt")));
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, MAX_PUBLIC_OTHER_FILES - 5);
    const stored = await db.select().from(attachments).where(eq(attachments.cardId, card.id));
    assert.equal(stored.length, MAX_PUBLIC_OTHER_FILES);
    assert.equal(stored.filter(a => a.uploadPurpose === "receipt").length, MAX_PUBLIC_OTHER_FILES - 2);
    await db.delete(boardStatuses).where(eq(boardStatuses.id, statuses[3].id));
    assert.equal((await getApplicationStatusByToken(suffix))?.canReceipt, false);
  } finally { await db.delete(boards).where(eq(boards.id, board.id)); await db.delete(users).where(eq(users.id, owner.id)); }
});

test("empty receipt source/target and archive precedence", () => {
  assert.equal(publicGates(false, false, 1, { resubmitStatusId: null, receiptToStatusId: 2 }, true).canReceipt, false);
  assert.equal(publicGates(false, true, 1, { resubmitStatusId: null, receiptToStatusId: null }, false).canReceipt, false);
  assert.equal(publicGates(true, true, 1, { resubmitStatusId: 1, receiptToStatusId: 2 }, true).canUploadDocuments, false);
  assert.equal(nextReceiptIndex(null, ["Q1.pdf", "Q3.pdf"]), 2);
  assert.equal(receiptFileName(null, 2, "old.pdf"), "Q2.pdf");
  const number = "A/2026";
  const existing = [receiptFileName(number, 1, "old.pdf"), receiptFileName(number, 3, "old.pdf")];
  assert.equal(nextReceiptIndex(number, existing), 2, "sanitized numbering uses the same prefix for allocation and display");
});

test("failed database association cleans only the new stored file; success never removes files", async () => {
  const removed: string[] = [];
  const saved = { relPath: "test/new-only.pdf", filename: "New.pdf", mime: "application/pdf", size: 5 };
  const file = new File(["%PDF-"], "New.pdf", { type: "application/pdf" });
  const dependencies = { save: async () => saved, insert: async () => { throw new Error("injected database failure"); }, remove: async (path: string) => { removed.push(path); } };
  await assert.rejects(storePublicAttachment(1, "general", file, dependencies), /injected/);
  assert.deepEqual(removed, [saved.relPath]);
  assert.equal(await storePublicAttachment(1, "general", file, { ...dependencies, insert: async () => "New.pdf" }), "New.pdf");
  assert.deepEqual(removed, [saved.relPath]);
});

test("templates copy all archive triggers, foreign sources are rejected, deleted sources disappear cleanly", async () => {
  const suffix = `triggers-${randomUUID()}`;
  const [owner] = await db.insert(users).values({ username: suffix }).returning();
  const [template] = await db.insert(boardTemplates).values({ name: suffix }).returning();
  const boardIds: number[] = [];
  try {
    await db.insert(boardTemplateStatuses).values([0,1,2,3].map(position => ({ templateId: template.id, name: String(position), position, isArchiveTrigger: true })));
    const boardId = await createBoardFromTemplate(owner.id, suffix, null, template.id); boardIds.push(boardId);
    const foreignId = await createBoardFromTemplate(owner.id, `${suffix}-other`, null, template.id); boardIds.push(foreignId);
    const statuses = await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, boardId));
    const [foreign] = await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, foreignId));
    assert.equal(statuses.filter(s => s.isArchiveTrigger).length, 4);
    assert.ok((await setBoardTriggerSources(boardId, "archive", [foreign.id])).error);
    assert.equal((await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, boardId))).filter(s => s.isArchiveTrigger).length, 4);
    await setBoardTriggerSources(boardId, "receipt", statuses.map(s=>s.id));
    await db.delete(boardStatuses).where(eq(boardStatuses.id, statuses[0].id));
    assert.equal((await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, boardId))).filter(s=>s.isReceiptTrigger).length, 3);
    await setBoardTriggerSources(boardId, "receipt", []);
    assert.equal((await db.select().from(boardStatuses).where(eq(boardStatuses.boardId, boardId))).filter(s=>s.isReceiptTrigger).length, 0);
  } finally {
    if(boardIds.length) await db.delete(boards).where(inArray(boards.id,boardIds));
    await db.delete(boardTemplates).where(eq(boardTemplates.id,template.id));
    await db.delete(users).where(eq(users.id,owner.id));
  }
});
