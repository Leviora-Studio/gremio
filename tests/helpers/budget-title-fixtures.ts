// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { accounts, cashbooks, financeBoards, financePlanItems } from "../../lib/db/schema";
/** Synthetic catalog for workflows whose subject is not catalog configuration. */
export async function budgetTitleFixture(ownerId:number, codes:string[], accountIds:number[] = [], cashbookIds:number[] = []) {
  const [board]=await db.insert(financeBoards).values({name:"Synthetic title catalog",ownerId}).returning();
  await db.insert(financePlanItems).values(codes.map(haushaltstitel=>({financeBoardId:board.id,kind:"expense" as const,haushaltstitel,title:`Purpose ${haushaltstitel}`})));
  if(accountIds.length)await db.update(accounts).set({financeBoardId:board.id}).where(inArray(accounts.id,accountIds));
  if(cashbookIds.length)await db.update(cashbooks).set({financeBoardId:board.id}).where(inArray(cashbooks.id,cashbookIds));
  return board.id;
}
