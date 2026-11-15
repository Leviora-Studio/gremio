// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import {and,eq,isNull} from "drizzle-orm";
import {db} from "@/lib/db";
import {applicationFormModules,boards,boardStatuses,locations,type User} from "@/lib/db/schema";
export type ApplicationModule="locations"|"finance";
export const applicationModuleLabels={locations:"Standorte",finance:"Finanzanträge-Formular"};
export async function getApplicationModuleState(){
 const [state]=await db.select().from(applicationFormModules).where(eq(applicationFormModules.id,1));
 return state??{id:1,activeModule:null,revision:0};
}
export async function setApplicationModule(user:User,module:ApplicationModule,enabled:boolean,revision:number,confirmation:string){
 if(!user.isActive||user.role!=="admin")throw new Error("Nur Administrationskonten dürfen Formularmodule verwalten.");
 if(!["locations","finance"].includes(module)||!Number.isSafeInteger(revision)||revision<0||typeof enabled!=="boolean")throw new Error("Ungültige Moduländerung.");
 if(confirmation!==(enabled?"BESTÄTIGEN":"DEAKTIVIEREN"))throw new Error(`Bitte ${enabled?"BESTÄTIGEN":"DEAKTIVIEREN"} genau so eingeben.`);
 return db.transaction(async tx=>{
  const [state]=await tx.select().from(applicationFormModules).where(eq(applicationFormModules.id,1)).for("update");
  if(!state||state.revision!==revision)throw new Error("Die Module wurden zwischenzeitlich geändert. Bitte die Seite aktualisieren.");
  if(enabled){
   if(state.activeModule!=null)throw new Error(`Bitte zuerst das Modul „${applicationModuleLabels[state.activeModule]}“ deaktivieren.`);
   const ready=await tx.select({id:locations.id}).from(locations).innerJoin(boards,trashAnd(activeRows.boards, eq(boards.id,locations.targetBoardId))).innerJoin(boardStatuses,trashAnd(activeRows.boardStatuses, and(eq(boardStatuses.id,locations.targetStatusId),eq(boardStatuses.boardId,locations.targetBoardId)))).where(trashAnd(activeRows.locations, and(eq(locations.module,module),eq(locations.enabled,true),isNull(boards.inventoryBoardId),module==="finance"?eq(boards.isApplicationBoard,true):undefined))).limit(1);
   if(!ready.length)throw new Error("Bitte zuerst mindestens einen Standort mit gültigem Ziel einrichten und aktivieren.");
  }else if(state.activeModule!==module)throw new Error("Dieses Modul ist bereits deaktiviert.");
  await tx.update(applicationFormModules).set({activeModule:enabled?module:null,revision:state.revision+1}).where(eq(applicationFormModules.id,1));
 });
}
