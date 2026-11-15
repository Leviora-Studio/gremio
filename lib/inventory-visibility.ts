// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryBoards, users, type User } from "@/lib/db/schema";
import { activeRows } from "@/lib/trash-visibility";
import { typedConfirmationError } from "@/lib/confirmation";
export async function setConfirmedInventoryFlag(actor:User,boardId:number,field:"isPublic"|"includeInOverview",enabled:boolean,confirmation:unknown){
  const word=field==="isPublic"?(enabled?"ÖFFENTLICH":"VERBERGEN"):(enabled?"EINBEZIEHEN":"AUSSCHLIESSEN");
  const invalid=typedConfirmationError(confirmation,word);if(invalid)return invalid;
  if(!Number.isSafeInteger(boardId)||boardId<1||typeof enabled!=="boolean")return {error:"Ungültige Änderung."};
  return db.transaction(async tx=>{
    const [board]=await tx.select({id:inventoryBoards.id}).from(inventoryBoards).where(and(activeRows.inventoryBoards,eq(inventoryBoards.id,boardId))).for("update");
    const [user]=await tx.select().from(users).where(eq(users.id,actor.id)).for("share");
    if(!user?.isActive||user.role!=="admin")return {error:"Keine aktiven Admin-Rechte."};
    if(!board)return {error:"Inventar nicht gefunden."};
    await tx.update(inventoryBoards).set(field==="isPublic"?{isPublic:enabled}:{includeInOverview:enabled}).where(eq(inventoryBoards.id,boardId));
    return {success:"Einstellung gespeichert."};
  });
}
