// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardCardFields, boards, locations } from "@/lib/db/schema";
import { APPLICATION_CARD_FIELD_KEYS } from "@/lib/constants";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serialize routing activation and field configuration on the same board. */
export async function lockLocationBoard(tx: Transaction, boardId: number) {
  await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).for("update");
}

export async function getLocationRequiredFieldKeys(boardId: number, reader: Transaction | typeof db = db): Promise<readonly string[]> {
  const [location] = await reader.select({ id: locations.id }).from(locations)
    .where(and(eq(locations.targetBoardId, boardId), eq(locations.enabled, true))).limit(1);
  return location ? APPLICATION_CARD_FIELD_KEYS : [];
}

/** Caller must lock the board before changing its routing or field settings. */
export async function enableApplicationCardFields(tx: Transaction, boardId: number) {
  const [row] = await tx.select({ position: max(boardCardFields.position) }).from(boardCardFields)
    .where(eq(boardCardFields.boardId, boardId));
  for (const [index, fieldKey] of APPLICATION_CARD_FIELD_KEYS.entries()) {
    await tx.insert(boardCardFields).values({ boardId, fieldKey, visible: true, position: (row?.position ?? -1) + index + 1 })
      .onConflictDoUpdate({ target: [boardCardFields.boardId, boardCardFields.fieldKey], set: { visible: true } });
  }
}
