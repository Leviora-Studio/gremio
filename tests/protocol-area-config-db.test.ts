// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { attachments, boardCardFields, boards, boardStatuses, cardAssignees, cards, protocolAreas, users } from "../lib/db/schema";
import { getProtocolSuggestions } from "../lib/protocols";
import { loadTaskOverviewData } from "../lib/task-overview-data";
import { getProtocolFinanceDetails } from "../lib/protocol-finance-fields";
after(() => pool.end());

test("area-local templates and ordered visible finance fields persist, without altering cards or leaking hidden values", async () => {
  const suffix = `protocol-config-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [owner, outsider] = await db.insert(users).values([{ username: suffix, role: "user" }, { username: `${suffix}-outsider`, role: "user" }]).returning();
  let boardId: number | undefined;
  const areaIds: number[] = [];
  try {
    const [board] = await db.insert(boards).values({ name: suffix, ownerId: owner.id }).returning(); boardId = board.id;
    const [status] = await db.insert(boardStatuses).values({ boardId: board.id, name: "Geplant", position: 0 }).returning();
    await db.insert(boardCardFields).values([{ fieldKey: "budget_title", visible: true }, { fieldKey: "assignee", visible: true }, { fieldKey: "finance_request", visible: true }, { fieldKey: "notes", visible: false }].map((field, position) => ({ ...field, position, boardId: board.id })));
    const [card] = await db.insert(cards).values({ boardId: board.id, statusId: status.id, title: "Test", applicant: "Test", token: suffix, budgetTitle: "0201", requestedAmount: 12345, notes: "HIDDEN NOTES", position: 3 }).returning();
    await db.insert(cardAssignees).values({ cardId: card.id, userId: owner.id });
    await db.insert(attachments).values({ cardId: card.id, kind: "finance_request", filename: "Antrag.pdf", path: "unused-test-path", size: 1, mime: "application/pdf" });
    const decision = "\n**Beschluss**  \n\n{{raw}}\n";
    const areas = await db.insert(protocolAreas).values(["A", "B"].map(name => ({ name: `${suffix}-${name}`, ownerId: owner.id, ncUrl: "https://example.invalid", ncUsername: "unused", ncPasswordEnc: "unused", rootPath: "/P", resultFilePattern: `Ergebnis-${name}-{date}.md`, templateId: null, customTemplateMarkdown: `# Area ${name}\n`, boardId: board.id, sourceStatusId: status.id, decisionTemplateEnabled: true, decisionTemplateMarkdown: decision }))).returning();
    areaIds.push(...areas.map(area => area.id));
    assert.equal(areas[0].customTemplateMarkdown, "# Area A\n"); assert.equal(areas[1].customTemplateMarkdown, "# Area B\n");
    assert.equal(areas[0].resultFilePattern, "Ergebnis-A-{date}.md"); assert.equal(areas[1].resultFilePattern, "Ergebnis-B-{date}.md");
    assert.equal(areas[0].decisionTemplateMarkdown, decision); assert.deepEqual(areas[0].financeFields, []);
    assert.deepEqual((await getProtocolSuggestions(owner, areas[0]))[0].fields, []);
    const fields = [{ key: "assignee", enabled: true }, { key: "budget_title", enabled: true }, { key: "notes", enabled: true }, { key: "finance_request", enabled: true }, { key: "created_at", enabled: false }];
    const [updated] = await db.update(protocolAreas).set({ financeFields: fields }).where(eq(protocolAreas.id, areas[0].id)).returning();
    const suggestions = await getProtocolSuggestions(owner, updated);
    assert.equal(suggestions[0].amount, null, "hidden requested amount must not leak through the suggestion header");
    assert.equal(suggestions[0].applicant, "", "hidden applicant must not leak through search/details");
    assert.equal(suggestions[0].number, null);
    assert.deepEqual(suggestions[0].fields?.map(field => field.key), ["assignee", "budget_title", "finance_request"]);
    assert.deepEqual(suggestions[0].fields?.map(field => field.value), [owner.username, "0201", "Antrag.pdf"]);
    assert.ok(!JSON.stringify(suggestions).includes("HIDDEN NOTES")); assert.ok(!JSON.stringify(suggestions).includes("unused-test-path")); assert.equal(Object.hasOwn(suggestions[0], "token"), false);
    assert.deepEqual(await getProtocolSuggestions(outsider, updated), []);
    const task = (await loadTaskOverviewData(owner)).cards.find(row => row.id === card.id)!;
    assert.equal(task.notes, null); assert.equal(task.applicant, "");
    assert.equal(task.budgetTitle, "0201", "visible fields remain available in tasks");
    assert.deepEqual((await getProtocolSuggestions(owner, areas[1]))[0].fields, []);
    await db.update(boardCardFields).set({ visible: false }).where(and(eq(boardCardFields.boardId, board.id), eq(boardCardFields.fieldKey, "budget_title")));
    assert.deepEqual((await getProtocolFinanceDetails(board.id, [card.id], fields)).get(card.id)?.map(field => field.key), ["assignee", "finance_request"]);
    const [unchanged] = await db.select().from(cards).where(eq(cards.id, card.id));
    assert.equal(unchanged.statusId, status.id); assert.equal(unchanged.position, 3); assert.equal(unchanged.decisionRef, null);
  } finally {
    if (areaIds.length) await db.delete(protocolAreas).where(inArray(protocolAreas.id, areaIds));
    if (boardId) await db.delete(boards).where(eq(boards.id, boardId));
    await db.delete(users).where(inArray(users.id, [owner.id, outsider.id]));
  }
});
