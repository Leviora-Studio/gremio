// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { accounts, attachments, boardCardFields, cardAssignees, cardBudgetPositions, cards, priorities, users, type Card } from "./db/schema";
import { budgetTitles } from "./card-budget";
import { availableProtocolFinanceFields, orderedProtocolFinanceFields, PROTOCOL_FINANCE_LABELS, type ProtocolFinanceField } from "./protocol-area-config";

export async function getProtocolBoardFields(boardIds: number[]) {
  if (!boardIds.length) return [];
  return db.select({ boardId: boardCardFields.boardId, key: boardCardFields.fieldKey, visible: boardCardFields.visible }).from(boardCardFields)
    .where(inArray(boardCardFields.boardId, boardIds)).orderBy(asc(boardCardFields.position), asc(boardCardFields.fieldKey));
}

const money = (amount: number | null) => amount === null ? "—" : (amount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const date = (value: string | null) => value?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1") ?? "—";
const timestamp = (value: Date) => value.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
type FieldCard = Pick<Card, "number" | "applicant" | "budgetTitle" | "requestedAmount" | "approvedAmount" | "actualAmount" | "deadline" | "meeting" | "decisionRef" | "instructionDate" | "transferDate" | "notes" | "applicantNote" | "createdAt" | "updatedAt">;
export function protocolFinanceValues(card: FieldCard, relations: { creator: string | null; priority: string | null; account: string | null; assignees: string[]; attachments: { kind: string; filename: string }[] }): Record<string, string> {
  const files = (kind: string) => relations.attachments.filter(file => file.kind === kind).map(file => file.filename).join(", ");
  return {
    number: card.number ?? "", applicant: card.applicant, budget_title: card.budgetTitle ?? "",
    requested_amount: money(card.requestedAmount), approved_amount: money(card.approvedAmount), actual_amount: money(card.actualAmount),
    creator: relations.creator ?? "", assignee: relations.assignees.join(", "), priority: relations.priority ?? "", account: relations.account ?? "",
    deadline: date(card.deadline), meeting: date(card.meeting), decision_ref: card.decisionRef ?? "", instruction_date: date(card.instructionDate), transfer_date: date(card.transferDate),
    notes: card.notes ?? "", applicant_note: card.applicantNote ?? "", created_at: timestamp(card.createdAt), updated_at: timestamp(card.updatedAt),
    finance_request: files("finance_request"), annex_a: files("annex_a"), annex_b: files("annex_b"), student_card: files("student_card"), other_pdfs: files("other"),
  };
}

/** Caller must verify board access first. Only the selected, currently visible values leave the server. */
export async function getProtocolFinanceDetails(boardId: number, cardIds: number[], configuration: ProtocolFinanceField[]) {
  const visible = (await getProtocolBoardFields([boardId])).filter(field => field.visible).map(field => field.key);
  const selected = orderedProtocolFinanceFields(configuration, availableProtocolFinanceFields(visible)).filter(field => field.enabled);
  const result = new Map<number, { key: string; label: string; value: string }[]>();
  if (!cardIds.length || !selected.length) return result;
  const [rows, assignees, files] = await Promise.all([
    db.select({ id: cards.id, card: {
      number: cards.number, applicant: cards.applicant, budgetTitle: cards.budgetTitle, requestedAmount: cards.requestedAmount, approvedAmount: cards.approvedAmount, actualAmount: cards.actualAmount,
      deadline: cards.deadline, meeting: cards.meeting, decisionRef: cards.decisionRef, instructionDate: cards.instructionDate, transferDate: cards.transferDate, notes: cards.notes, applicantNote: cards.applicantNote, createdAt: cards.createdAt, updatedAt: cards.updatedAt,
    }, creator: users.username, priority: priorities.label, account: accounts.name }).from(cards)
      .leftJoin(users, eq(users.id, cards.creatorUserId)).leftJoin(priorities, eq(priorities.id, cards.priorityId)).leftJoin(accounts, eq(accounts.id, cards.accountId)).where(and(eq(cards.boardId, boardId), inArray(cards.id, cardIds))),
    db.select({ cardId: cardAssignees.cardId, name: users.username }).from(cardAssignees).innerJoin(users, eq(users.id, cardAssignees.userId)).where(inArray(cardAssignees.cardId, cardIds)).orderBy(asc(users.username)),
    db.select({ cardId: attachments.cardId, kind: attachments.kind, filename: attachments.filename }).from(attachments).where(inArray(attachments.cardId, cardIds)).orderBy(asc(attachments.id)),
  ]);
  const positions = await db.select({ cardId: cardBudgetPositions.cardId, budgetTitle: cardBudgetPositions.budgetTitle, account: accounts.name }).from(cardBudgetPositions).innerJoin(cards, eq(cards.id, cardBudgetPositions.cardId)).innerJoin(accounts, eq(accounts.id, cardBudgetPositions.accountId)).where(and(eq(cards.boardId, boardId), inArray(cards.id, cardIds))).orderBy(asc(cardBudgetPositions.position));
  for (const row of rows) {
    const budget = positions.filter((p) => p.cardId === row.id);
    if (budget.length) { row.card.budgetTitle = budgetTitles(budget); row.account = [...new Set(budget.map((p) => p.account))].join(", "); }
    const values = protocolFinanceValues(row.card, { ...row, assignees: assignees.filter(value => value.cardId === row.id).map(value => value.name), attachments: files.filter(file => file.cardId === row.id) });
    result.set(row.id, selected.map(field => ({ key: field.key, label: PROTOCOL_FINANCE_LABELS[field.key], value: values[field.key] || "—" })));
  }
  return result;
}
