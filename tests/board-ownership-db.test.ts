// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../lib/db";
import {users,boards,financeBoards,inventoryBoards,boardAccess} from "../lib/db/schema";
import {changeOwnership,isResourceOwner,resourceOwners,type OwnershipKind} from "../lib/board-ownership";
import {canAccessBoard,canManageBoard,getAccessibleBoards,getBoardMemberUsers} from "../lib/authz";
import {canAccessFinanceBoard,canManageFinanceBoard,getAccessibleFinanceBoards} from "../lib/finance";
import {canAccessInventoryBoard,canManageInventoryBoard,getAccessibleInventoryBoards} from "../lib/inventory";
import {serializeBoard} from "../lib/api";
after(()=>pool.end());
test("equal board owners, typed confirmation, admin removal and serialized last-owner protection apply to all board kinds",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const people=await db.insert(users).values([{username:randomUUID()},{username:randomUUID()},{username:randomUUID(),role:"admin"},{username:randomUUID()}]).returning();const [original,added,admin,outsider]=people;
 try{for(const kind of ["board","finance","inventory"] as OwnershipKind[]){
  const table=kind==="board"?boards:kind==="finance"?financeBoards:inventoryBoards;
  const [resource]=await db.insert(table).values({name:"Ownership fixture",ownerId:original.id}).returning();let systemId:number|undefined;
  try{
   await assert.rejects(changeOwnership(original,kind,resource.id,added.id,"add",""));
   await assert.rejects(changeOwnership(outsider,kind,resource.id,added.id,"add","ERNENNEN"));
   await assert.rejects(changeOwnership(admin,kind,resource.id,original.id,"remove","ENTZIEHEN"),/letzte Eigentümer/);
   await changeOwnership(original,kind,resource.id,added.id,"add","ERNENNEN");assert.equal((await resourceOwners(kind,resource.id)).length,2);assert.equal(await isResourceOwner(kind,resource,added.id),true);
   if(kind==="board"){
    const row=(await db.select().from(boards).where(eq(boards.id,resource.id)))[0];assert.ok(await canManageBoard(added,row));assert.ok(await canAccessBoard(added,row,"write"));assert.ok((await getAccessibleBoards(added)).some(b=>b.id===row.id));assert.ok((await getBoardMemberUsers(row)).some(u=>u.id===added.id));assert.equal((await serializeBoard(row,added)).role,"owner");
    await db.insert(boardAccess).values({boardId:row.id,userId:original.id,accessLevel:"read"});
   }else if(kind==="finance"){
    const row=(await db.select().from(financeBoards).where(eq(financeBoards.id,resource.id)))[0];assert.ok(await canManageFinanceBoard(added,row));assert.ok(await canAccessFinanceBoard(added,row,"write"));assert.ok((await getAccessibleFinanceBoards(added)).some(b=>b.id===row.id));
   }else{
    const row=(await db.select().from(inventoryBoards).where(eq(inventoryBoards.id,resource.id)))[0];assert.ok(await canManageInventoryBoard(added,row));assert.ok(await canAccessInventoryBoard(added,row,"write"));assert.ok((await getAccessibleInventoryBoards(added)).some(b=>b.id===row.id));
    const [system]=await db.insert(boards).values({name:"Loans",ownerId:original.id,inventoryBoardId:row.id}).returning();systemId=system.id;await db.update(inventoryBoards).set({loanBoardId:system.id}).where(eq(inventoryBoards.id,row.id));assert.ok(await canManageBoard(added,system));assert.ok(await canAccessBoard(added,system,"write"));assert.ok((await getBoardMemberUsers(system)).some(u=>u.id===added.id));assert.ok((await getAccessibleBoards(added)).some(b=>b.id===system.id));
   }
   await assert.rejects(changeOwnership(added,kind,resource.id,original.id,"remove","ENTZIEHEN"),/Nur Admins/);
   const attempts=await Promise.allSettled([changeOwnership(original,kind,resource.id,original.id,"remove","ENTZIEHEN"),changeOwnership(added,kind,resource.id,added.id,"remove","ENTZIEHEN")]);assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);const remaining=await resourceOwners(kind,resource.id);assert.equal(remaining.length,1);
   await assert.rejects(changeOwnership(admin,kind,resource.id,remaining[0].id,"remove","ENTZIEHEN"),/letzte Eigentümer/);
   await changeOwnership(admin,kind,resource.id,admin.id,"add","ERNENNEN");await changeOwnership(admin,kind,resource.id,remaining[0].id,"remove","ENTZIEHEN");assert.deepEqual((await resourceOwners(kind,resource.id)).map(u=>u.id),[admin.id]);
  }finally{if(systemId){await db.update(inventoryBoards).set({loanBoardId:null}).where(eq(inventoryBoards.id,resource.id));await db.delete(boards).where(eq(boards.id,systemId));}await db.delete(table).where(eq(table.id,resource.id));}
 }}finally{await db.delete(users).where(inArray(users.id,people.map(u=>u.id)));}
});
