// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, cards, cardBudgetPlans, cardBudgetPositions, cashbooks, cashbookEntries, financeBoardSources, users, type FinanceBoard } from "@/lib/db/schema";
import { canAccessBoard } from "@/lib/authz";
import { cashbookPermission } from "./access";
import { effectiveCashbookEntries } from "./projection";
import type { AntragRow } from "@/lib/finance-data";

export async function cashbookFinanceProjection(fb:FinanceBoard,sourceIds:number[],fallbackAccounts:number[]) {
    const [book]=fb.cashbookId?await db.select().from(cashbooks).where(trashAnd(activeRows.cashbooks, eq(cashbooks.id,fb.cashbookId))):[];
    const [owner]=await db.select().from(users).where(eq(users.id,fb.ownerId));
    if(!book||!owner||!["manage","read","write"].includes(await cashbookPermission(owner,book)??"")) throw new Error("Der Eigentümer der Finanzübersicht benötigt weiterhin Lesezugriff auf das verknüpfte Kassenbuch.");
    const posted=effectiveCashbookEntries(await db.select().from(cashbookEntries).where(trashAnd(activeRows.cashbookEntries, eq(cashbookEntries.cashbookId,book.id)))).filter(entry=>entry.state==="posted");
    const actual=new Map<string,number>(),live=new Map<string,number>();
    const paidByCard=new Map<number,Map<string,number>>();
    for(const entry of posted){
        const title=entry.data.budgetTitle;
        actual.set(title,(actual.get(title)??0)+entry.data.amount);live.set(title,(live.get(title)??0)+entry.data.amount);
        if(entry.data.cardId!=null){const paid=paidByCard.get(entry.data.cardId)??new Map<string,number>();paid.set(title,(paid.get(title)??0)+entry.data.amount);paidByCard.set(entry.data.cardId,paid);}
    }
    const linkedIds=[...paidByCard.keys()];
    const sources=sourceIds.length?await db.select({source:financeBoardSources,board:boards}).from(financeBoardSources).innerJoin(boards,trashAnd(activeRows.boards, eq(boards.id,financeBoardSources.boardId))).where(and(eq(financeBoardSources.financeBoardId,fb.id),inArray(financeBoardSources.boardId,sourceIds))):[];
    const allCards=sourceIds.length||linkedIds.length?await db.select().from(cards).where(trashAnd(activeRows.cards, or(sourceIds.length?inArray(cards.boardId,sourceIds):undefined,linkedIds.length?inArray(cards.id,linkedIds):undefined))):[];
    const cardIds=allCards.map(card=>card.id);
    const plans=cardIds.length?await db.select().from(cardBudgetPlans).where(trashAnd(activeRows.cardBudgetPlans, inArray(cardBudgetPlans.cardId,cardIds))):[];
    const positions=cardIds.length?await db.select().from(cardBudgetPositions).where(trashAnd(activeRows.cardBudgetPositions, inArray(cardBudgetPositions.cardId,cardIds))):[];
    const boardIds=[...new Set(allCards.map(card=>card.boardId))];
    const sourceBoards=boardIds.length?await db.select().from(boards).where(trashAnd(activeRows.boards, inArray(boards.id,boardIds))):[];
    const readableBoards=new Set<number>();
    for(const board of sourceBoards)if(await canAccessBoard(owner,board))readableBoards.add(board.id);
    const cardRows:AntragRow[]=[];
    for(const id of new Set([...cardIds,...linkedIds])){
        const card=allCards.find(row=>row.id===id),config=card?sources.find(row=>row.board.id===card.boardId):undefined;
        const paid=paidByCard.get(id)??new Map<string,number>();
        const readable=!!card&&readableBoards.has(card.boardId);
        const accountIds=config?.source.accountId?[config.source.accountId]:fallbackAccounts;
        const plan=plans.find(row=>row.cardId===id);
        const budgetRows=readable?(plan?plan.allocations:card!.budgetMode==="positions"?positions.filter(row=>row.cardId===id).map(row=>({amount:row.approvedAmount??0,budgetTitle:row.budgetTitle??"",accountId:row.accountId})):[{amount:card!.approvedAmount??0,budgetTitle:card!.budgetTitle??"",accountId:card!.accountId}]):[];
        const selectedRows=config?budgetRows.filter(row=>row.accountId!=null&&accountIds.includes(row.accountId)):budgetRows;
        const eligible=!!config&&selectedRows.length>0;
        if(!eligible&&!paid.size)continue;
        const approved=new Map<string,number>();
        for(const row of paid.size ? budgetRows : selectedRows)if(row.budgetTitle)approved.set(row.budgetTitle,(approved.get(row.budgetTitle)??0)+row.amount);
        const forecast=new Map<string,number>();
        for(const row of selectedRows)if(row.budgetTitle)forecast.set(row.budgetTitle,(forecast.get(row.budgetTitle)??0)+row.amount);
        // Only configured source plans replace actual payments in the live forecast.
        if(eligible&&card){
            const expired=config!.source.expiredStatusId===card.statusId;
            if(expired||card.statusId!==config!.board.completedStatusId){
                for(const [title,value] of paid)if(forecast.has(title))live.set(title,(live.get(title)??0)-value);
                if(!expired)for(const [title,value] of forecast)live.set(title,(live.get(title)??0)+value);
            }
        }
        const titles=[...new Set([...approved.keys(),...paid.keys()])];
        const breakdown=titles.map(title=>({title,approved:approved.get(title)??0,paid:paid.get(title)??0,outstanding:Math.max(0,(approved.get(title)??0)-(paid.get(title)??0))}));
        const sourceEntry=posted.find(entry=>entry.data.cardId===id);
        const number=readable?card!.number:sourceEntry?.data.number??String(id);
        cardRows.push({id,number,title:readable?card!.title:`Antrag ${number}`,applicant:readable?card!.applicant:"",budgetTitle:titles.join(", "),decisionRef:readable?card!.decisionRef:null,instructionDate:readable?card!.instructionDate:null,transferDate:readable?card!.transferDate:null,accountId:readable?card!.accountId:null,approvedAmount:breakdown.reduce((sum,row)=>sum+row.outstanding,0),actualAmount:breakdown.reduce((sum,row)=>sum+row.paid,0),breakdown,...(!readable&&sourceEntry?{href:`/intern/kassenbuch/vorgang/${sourceEntry.id}`}:{})});
    }
    return {live,actual,cardRows};
}
