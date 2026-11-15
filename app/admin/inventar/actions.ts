// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setConfirmedInventoryFlag } from "@/lib/inventory-visibility";
export async function setInventoryBoardPublicAction(formData:FormData){
  const value=formData.get("isPublic");if(value!=="0"&&value!=="1")return {error:"Ungültige Änderung."};
  return setInventoryBoardPublicConfirmedAction(Number(formData.get("boardId")),value==="1",formData.get("confirmation"));
}
export async function setInventoryBoardPublicConfirmedAction(boardId:number,enabled:boolean,confirmation?:unknown){
  const user=await requireAdmin();const result=await setConfirmedInventoryFlag(user,boardId,"isPublic",enabled,confirmation);
  revalidatePath("/admin/inventar");revalidatePath("/inventar");return result;
}
