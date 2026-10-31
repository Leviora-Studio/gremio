// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {and,eq,inArray} from "drizzle-orm";
import {db} from "@/lib/db";
import {boards,financeBoards,inventoryBoards,boardOwners,financeBoardOwners,inventoryBoardOwners,users,type User} from "@/lib/db/schema";
export type OwnershipKind="board"|"finance"|"inventory";
const resources={board:boards,finance:financeBoards,inventory:inventoryBoards};
const memberships={board:boardOwners,finance:financeBoardOwners,inventory:inventoryBoardOwners};
export class OwnershipError extends Error {}
export async function isResourceOwner(kind:OwnershipKind,resource:{id:number;ownerId:number},userId:number):Promise<boolean>{
  if(resource.ownerId===userId)return true;
  const t=memberships[kind];const [row]=await db.select({id:t.userId}).from(t).where(and(eq(t.boardId,resource.id),eq(t.userId,userId))).limit(1);return !!row;
}
export async function additionalOwnedIds(kind:OwnershipKind,userId:number){const t=memberships[kind];return db.select({id:t.boardId}).from(t).where(eq(t.userId,userId));}
export async function resourceOwners(kind:OwnershipKind,id:number){
  const t=resources[kind],m=memberships[kind];const [r]=await db.select({ownerId:t.ownerId}).from(t).where(eq(t.id,id));if(!r)return [];
  const extra=await db.select({id:m.userId}).from(m).where(eq(m.boardId,id));
  return db.select({id:users.id,username:users.username,name:users.name,isActive:users.isActive}).from(users).where(inArray(users.id,[r.ownerId,...extra.map(x=>x.id)])).orderBy(users.username);
}
/** Lock the resource to serialize appointments, departures and last-owner checks. */
export async function changeOwnership(actor:User,kind:OwnershipKind,id:number,targetId:number,operation:"add"|"remove",confirmation:string){
  if(!Object.hasOwn(resources,kind))throw new OwnershipError("Ungültiges Board.");
  if(!actor.isActive||!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(targetId)||targetId<1||!["add","remove"].includes(operation))throw new OwnershipError("Ungültige Eigentümeränderung.");
  if(confirmation.trim()!==(operation==="add"?"ERNENNEN":"ENTZIEHEN"))throw new OwnershipError("Bitte die Änderung durch Eingabe des Bestätigungsworts bestätigen.");
  if(kind==="board"){
    const [board]=await db.select({inventoryId:boards.inventoryBoardId}).from(boards).where(eq(boards.id,id));
    if(board?.inventoryId!=null)return changeOwnership(actor,"inventory",board.inventoryId,targetId,operation,confirmation);
  }
  const t=resources[kind],m=memberships[kind];
  await db.transaction(async tx=>{
    const [resource]=await tx.select({id:t.id,ownerId:t.ownerId}).from(t).where(eq(t.id,id)).for("update");
    if(!resource)throw new OwnershipError("Board nicht gefunden.");
    const [liveActor]=await tx.select().from(users).where(eq(users.id,actor.id)).for("share");
    if(!liveActor?.isActive)throw new OwnershipError("Kein Zugriff.");
    const extra=await tx.select({id:m.userId}).from(m).where(eq(m.boardId,id));const owners=new Set([resource.ownerId,...extra.map(x=>x.id)]);
    if(liveActor.role!=="admin"&&!owners.has(actor.id))throw new OwnershipError("Nur Eigentümer und Admins dürfen Eigentümerschaften verwalten.");
    if(operation==="add"){
      const [target]=await tx.select().from(users).where(and(eq(users.id,targetId),eq(users.isActive,true))).for("share");
      if(!target)throw new OwnershipError("Bitte eine aktive Person auswählen.");
      if(!owners.has(targetId))await tx.insert(m).values({boardId:id,userId:targetId});
      return;
    }
    if(liveActor.role!=="admin"&&actor.id!==targetId)throw new OwnershipError("Nur Admins dürfen anderen Personen die Eigentümerschaft entziehen.");
    if(!owners.has(targetId))throw new OwnershipError("Diese Person ist kein Eigentümer mehr.");
    if(owners.size===1)throw new OwnershipError("Dies ist der letzte Eigentümer. Ernenne zuerst mindestens eine weitere Person zum Eigentümer.");
    if(resource.ownerId===targetId){
      const successor=[...owners].filter(x=>x!==targetId).sort((a,b)=>a-b)[0];
      await tx.update(t).set({ownerId:successor}).where(eq(t.id,id));
      await tx.delete(m).where(and(eq(m.boardId,id),eq(m.userId,successor)));
      if(kind==="inventory")await tx.update(boards).set({ownerId:successor}).where(eq(boards.inventoryBoardId,id));
    }
    await tx.delete(m).where(and(eq(m.boardId,id),eq(m.userId,targetId)));
  });
}
