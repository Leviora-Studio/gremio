// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, boards, cards, cardBudgetPositions, type User } from "@/lib/db/schema";
import { canAccessBoard } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { formatCents } from "@/lib/money";

export type FinanceDetails = { cardId:number; applicant:string; account:string; budgetTitle:string; amount:string };
/** Never copy source data into shared TOP content. Re-evaluate board and field visibility on every read/export. */
export async function projectFinanceTopics<T extends {title:string;isFinanceItem:boolean;financeCardId:number|null}>(user:User,topics:T[]):Promise<(T&{financeDetails?:FinanceDetails})[]> {
  const ids=topics.flatMap(t=>t.isFinanceItem&&t.financeCardId!=null?[t.financeCardId]:[]);
  if(!ids.length)return topics.map(t=>t.isFinanceItem?{...t,title:"Finanzantrag (nicht mehr verfügbar)"}:t);
  const rows=await db.select({card:cards,board:boards}).from(cards).innerJoin(boards,eq(boards.id,cards.boardId)).where(inArray(cards.id,ids));
  const result=new Map<number,{title:string;financeDetails:FinanceDetails}>();
  for(const board of [...new Map(rows.map(r=>[r.board.id,r.board])).values()]) {
    if(!await canAccessBoard(user,board))continue;
    const fields=await getVisibleFieldKeys(board.id);
    for(const {card} of rows.filter(r=>r.board.id===board.id)) {
      const positions=card.budgetMode==="positions"?await db.select().from(cardBudgetPositions).where(eq(cardBudgetPositions.cardId,card.id)):[];
      const accountIds=fields.has("account")?(positions.length?positions.map(p=>p.accountId):card.accountId?[card.accountId]:[]):[];
      const accountRows=accountIds.length?await db.select({name:accounts.name}).from(accounts).where(inArray(accounts.id,accountIds)):[];
      result.set(card.id,{title:[fields.has("number")?card.number:null,card.title].filter(Boolean).join(" "),financeDetails:{cardId:card.id,
        applicant:fields.has("applicant")?card.applicant||"—":"Nicht freigegeben",
        account:fields.has("account")?accountRows.map(a=>a.name).join(", ")||"—":"Nicht freigegeben",
        budgetTitle:fields.has("budget_title")?[...new Set(positions.length?positions.map(p=>p.budgetTitle):[card.budgetTitle])].filter(Boolean).join(", ")||"—":"Nicht freigegeben",
        amount:fields.has("requested_amount")?formatCents(card.requestedAmount)||"—":"Nicht freigegeben"}});
    }
  }
  return topics.map(t=>!t.isFinanceItem?t:({...t,title:"Finanzantrag (kein Zugriff oder nicht mehr verfügbar)",financeCardId:null,...(t.financeCardId!=null&&result.has(t.financeCardId)?{...result.get(t.financeCardId),financeCardId:t.financeCardId}:{})}));
}
