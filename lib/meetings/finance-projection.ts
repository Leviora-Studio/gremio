// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, boards, cards, cardBudgetPositions, type User } from "@/lib/db/schema";
import { canAccessBoard } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import {financeMotionFields,renderFinanceMotion} from "./finance-motion";
import { formatCents } from "@/lib/money";

export type FinanceDetails = { cardId:number; applicant:string; account:string; budgetTitle:string; amount:string };
/** Never copy source data into shared TOP content. Re-evaluate board and field visibility on every read/export. */
export async function projectFinanceTopics<T extends {title:string;isFinanceItem:boolean;financeCardId:number|null;motion?:string}>(user:User,topics:T[]):Promise<(T&{financeDetails?:FinanceDetails})[]> {
  const ids=topics.flatMap(t=>t.isFinanceItem&&t.financeCardId!=null?[t.financeCardId]:[]);
  if(!ids.length)return topics.map(t=>t.isFinanceItem?{...t,title:"Finanzantrag (nicht mehr verfügbar)",...(t.motion!==undefined?{motion:renderFinanceMotion(t.motion,{})}:{})}:t);
  const rows=await db.select({card:cards,board:boards}).from(cards).innerJoin(boards,eq(boards.id,cards.boardId)).where(inArray(cards.id,ids));
  const result=new Map<number,{title:string;financeDetails:FinanceDetails;values:Record<string,string>}>();
  for(const board of [...new Map(rows.map(r=>[r.board.id,r.board])).values()]) {
    if(!await canAccessBoard(user,board))continue;
    const fields=await getVisibleFieldKeys(board.id);
    for(const {card} of rows.filter(r=>r.board.id===board.id)) {
      const positions=card.budgetMode==="positions"?await db.select().from(cardBudgetPositions).where(eq(cardBudgetPositions.cardId,card.id)):[];
      const accountIds=fields.has("account")?(positions.length?positions.map(p=>p.accountId):card.accountId?[card.accountId]:[]):[];
      const accountRows=accountIds.length?await db.select({name:accounts.name}).from(accounts).where(inArray(accounts.id,accountIds)):[];
      const values:Record<string,string>={};
      for(const field of financeMotionFields){
        let value="";
        if(field.field&&!fields.has(field.field)){values[field.key]="Nicht freigegeben";continue;}
        switch(field.key){
          case "title":value=card.title;break;
          case "number":value=card.number??"";break;
          case "applicant":value=card.applicant;break;
          case "requested_amount":value=formatCents(card.requestedAmount);break;
          case "approved_amount":value=formatCents(card.approvedAmount);break;
          case "actual_amount":value=formatCents(card.actualAmount);break;
          case "account":value=accountRows.map(a=>a.name).join(", ");break;
          case "budget_title":value=[...new Set(positions.length?positions.map(p=>p.budgetTitle):[card.budgetTitle])].filter(Boolean).join(", ");break;
          case "decision_ref":value=card.decisionRef??"";break;
          case "notes":value=card.notes??"";break;
          case "applicant_note":value=card.applicantNote??"";break;
          default:{const dates={deadline:card.deadline,meeting:card.meeting,instruction_date:card.instructionDate,transfer_date:card.transferDate};const date=dates[field.key];value=date?date.split("-").reverse().join("."):"";}
        }
        values[field.key]=value||"—";
      }
      result.set(card.id,{values,title:[fields.has("number")?card.number:null,card.title].filter(Boolean).join(" "),financeDetails:{cardId:card.id,
        applicant:fields.has("applicant")?card.applicant||"—":"Nicht freigegeben",
        account:fields.has("account")?accountRows.map(a=>a.name).join(", ")||"—":"Nicht freigegeben",
        budgetTitle:fields.has("budget_title")?[...new Set(positions.length?positions.map(p=>p.budgetTitle):[card.budgetTitle])].filter(Boolean).join(", ")||"—":"Nicht freigegeben",
        amount:fields.has("requested_amount")?formatCents(card.requestedAmount)||"—":"Nicht freigegeben"}});
    }
  }
  return topics.map(t=>{
    if(!t.isFinanceItem)return t;
    const projected=t.financeCardId!=null?result.get(t.financeCardId):undefined;
    return {...t,title:projected?.title??"Finanzantrag (kein Zugriff oder nicht mehr verfügbar)",financeCardId:projected?t.financeCardId:null,
      ...(projected?{financeDetails:projected.financeDetails}:{}),
      ...(t.motion!==undefined?{motion:renderFinanceMotion(t.motion,projected?.values??{})}:{})};
  });
}
