// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  setOverviewMinPrice,
} from "@/lib/inventory-overview";
import { setConfirmedInventoryFlag } from "@/lib/inventory-visibility";
import { parseEuroToCents as parseEuro } from "@/lib/money";

/** Mindestpreis-Eingabe → Cent (0 = kein Minimum). */
function parseEuroToCents(raw: FormDataEntryValue | null): number {
  return typeof raw === "string" ? (parseEuro(raw) ?? 0) : 0;
}

export async function setOverviewMinPriceAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  await setOverviewMinPrice(parseEuroToCents(formData.get("minPrice")));
  revalidatePath("/admin/inventar/gesamt");
}

export async function toggleBoardOverviewAction(formData:FormData){
  const value=formData.get("include");if(value!=="0"&&value!=="1")return {error:"Ungültige Änderung."};
  return setBoardOverviewConfirmedAction(Number(formData.get("boardId")),value==="1",formData.get("confirmation"));
}
export async function setBoardOverviewConfirmedAction(boardId:number,enabled:boolean,confirmation?:unknown){
  const user=await requireAdmin();const result=await setConfirmedInventoryFlag(user,boardId,"includeInOverview",enabled,confirmation);
  revalidatePath("/admin/inventar/gesamt");revalidatePath("/intern/inventar/gesamt");return result;
}
