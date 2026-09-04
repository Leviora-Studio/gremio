// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/** Apply before serializing client props or building searchable text. */
export function maskHiddenCardFields<T extends object>(value: T, visible: ReadonlySet<string>): T {
  const result = { ...value } as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    applicant: ["applicant"], budget_title: ["budgetTitle"], number: ["number"],
    creator: ["creatorUserId", "creator"], assignee: ["assigneeUserIds", "assignees"],
    deadline: ["deadline"], meeting: ["meeting"], decision_ref: ["decisionRef"],
    instruction_date: ["instructionDate"], transfer_date: ["transferDate"],
    requested_amount: ["requestedAmount"], approved_amount: ["approvedAmount"],
    actual_amount: ["actualAmount"], priority: ["priorityId"],
    account: ["accountId", "accountName"], notes: ["notes"], applicant_note: ["applicantNote"],
  };
  for (const [field, keys] of Object.entries(fields)) {
    if (visible.has(field)) continue;
    for (const key of keys) if (key in result) {
      result[key] = key === "applicant" ? "" : key === "assigneeUserIds" || key === "assignees" ? [] : null;
    }
  }
  return result as T;
}
