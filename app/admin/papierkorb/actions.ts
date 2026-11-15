// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { requireAdmin } from "@/lib/auth";
import { restoreTrashEntry, purgeTrashEntry, TrashError } from "@/lib/trash";
import { revalidatePath } from "next/cache";
export async function restoreTrashAction(id:number,confirmation?:string){
 const user=await requireAdmin();
 try{await restoreTrashEntry(user,id,confirmation);}catch(error){return {error:error instanceof TrashError?error.message:"Wiederherstellung nicht möglich. Bitte die verknüpften Ressourcen prüfen."};}
 revalidatePath("/", "layout");return {};
}
export async function purgeTrashAction(id:number,confirmation?:string){
 const user=await requireAdmin();
 try{await purgeTrashEntry(user,id,confirmation);}catch(error){revalidatePath("/", "layout");return {error:error instanceof TrashError?error.message:"Endgültige Löschung nicht möglich. Bitte verknüpfte Ressourcen prüfen. Eine bereits begonnene Dateibereinigung kann erneut ausgeführt werden."};}
 revalidatePath("/", "layout");return {};
}
