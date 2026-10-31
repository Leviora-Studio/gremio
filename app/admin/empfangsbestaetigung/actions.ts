// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import {requireAdmin} from "@/lib/auth";
import {revalidatePath} from "next/cache";
import {saveReceiptBranding,type ReceiptScope,type BrandingState} from "@/lib/receipt-branding";
export async function saveReceiptBrandingAction(_previous:BrandingState,form:FormData){
  const result=await saveReceiptBranding(await requireAdmin(),undefined,form);
  if(result.success)revalidatePath("/admin/empfangsbestaetigung");return result;
}
export async function saveScopedReceiptBrandingAction(scope:ReceiptScope,_previous:BrandingState,form:FormData){
  const result=await saveReceiptBranding(await requireAdmin(),scope,form);
  if(result.success){revalidatePath("/admin/standorte");revalidatePath("/admin/umfragen");}return result;
}
