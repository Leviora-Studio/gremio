// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardCardFields } from "@/lib/db/schema";

/**
 * Die am Board AKTIVIERTEN (sichtbaren) Kartenfeld-Schlüssel. Maßgeblich dafür,
 * welche optionalen Felder bearbeitet werden dürfen — in der Web-UI (nur
 * sichtbare Felder werden gerendert/gespeichert) UND in der REST-API, damit die
 * API nie mehr erlaubt als die Web-App.
 */
export async function getVisibleFieldKeys(
  boardId: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ fieldKey: boardCardFields.fieldKey })
    .from(boardCardFields)
    .where(
      and(eq(boardCardFields.boardId, boardId), eq(boardCardFields.visible, true)),
    );
  return new Set(rows.map((r) => r.fieldKey));
}

/**
 * Abbildung API-Eingabefeld → board_card_fields-Schlüssel. Felder ohne Eintrag
 * (title, statusId, position, archived) sind keine optionalen Board-Felder:
 * Titel/Status/Position sind Kern-Operationen jedes Mitglieds; `archived` ist
 * verwalter-exklusiv und separat geprüft.
 */
export const API_FIELD_TO_KEY: Record<string, string> = {
  applicant: "applicant",
  budgetTitle: "budget_title",
  number: "number",
  creatorUserId: "creator",
  assigneeUserId: "assignee",
  deadline: "deadline",
  meeting: "meeting",
  decisionRef: "decision_ref",
  instructionDate: "instruction_date",
  transferDate: "transfer_date",
  approvedAmountCents: "approved_amount",
  actualAmountCents: "actual_amount",
  priorityId: "priority",
  accountId: "account",
  notes: "notes",
  applicantNote: "applicant_note",
};
