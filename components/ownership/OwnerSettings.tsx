// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {cache} from "react";
import {eq} from "drizzle-orm";
import {requireUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {boards,users} from "@/lib/db/schema";
import {resourceOwners,type OwnershipKind} from "@/lib/board-ownership";
import {OwnerSettingsClient} from "./OwnerSettingsClient";
const eligiblePeople=cache(async()=>db.select({id:users.id,username:users.username,name:users.name}).from(users).where(eq(users.isActive,true)).orderBy(users.username));
export async function OwnerSettings({kind,id}:{kind:OwnershipKind;id:number}){
  if(kind==="board"){const [board]=await db.select({inventoryId:boards.inventoryBoardId}).from(boards).where(eq(boards.id,id));if(board?.inventoryId!=null)return <OwnerSettings kind="inventory" id={board.inventoryId}/>;}
  const user=await requireUser();const owners=await resourceOwners(kind,id);
  if(user.role!=="admin"&&!owners.some(o=>o.id===user.id))return null;
  const candidates=await eligiblePeople();
  return <OwnerSettingsClient kind={kind} id={id} owners={owners} candidates={candidates.filter(c=>!owners.some(o=>o.id===c.id))} currentUserId={user.id} admin={user.role==="admin"}/>;
}
