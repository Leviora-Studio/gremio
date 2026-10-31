// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import {requireUser} from "@/lib/auth";
import {changeOwnership,OwnershipError,type OwnershipKind} from "@/lib/board-ownership";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
export async function changeOwnerAction(kind:OwnershipKind,id:number,targetId:number,operation:"add"|"remove",confirmation:string):Promise<{error?:string}> {
  const user=await requireUser();
  if(!["board","finance","inventory"].includes(kind))return {error:"Ungültiges Board."};
  try {await changeOwnership(user,kind,id,targetId,operation,confirmation);}
  catch(error){return {error:error instanceof OwnershipError?error.message:"Die Eigentümeränderung konnte nicht gespeichert werden."};}
  revalidatePath("/intern","layout");revalidatePath("/finanzen","layout");revalidatePath("/admin","layout");
  if(operation==="remove"&&targetId===user.id&&user.role!=="admin")redirect(kind==="finance"?"/finanzen":kind==="inventory"?"/intern/inventar":"/intern/boards");
  return {};
}
