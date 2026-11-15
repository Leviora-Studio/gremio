// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { requireUser } from "@/lib/auth";
import { saveCashbookArchive, testCashbookArchive } from "@/lib/cashbook/archive";
import { revalidatePath } from "next/cache";
export async function saveCashbookArchiveAction(bookId:number,revision:number,input:unknown) {
 const user=await requireUser();
 try { await saveCashbookArchive(user,bookId,revision,input); }
 catch(error) { return {error:error instanceof Error&&!('cause' in error)&&error.name!=="ZodError"?error.message:"Bitte alle Archiv-Einstellungen prüfen."}; }
 revalidatePath(`/intern/kassenbuch/${bookId}/einstellungen`);return {success:"Archiv-Einstellungen gespeichert."};
}
export async function testCashbookArchiveAction(bookId:number) {
 const user=await requireUser();
 try { await testCashbookArchive(user,bookId);return {success:"Verbindung OK – Stammordner erreichbar."}; }
 catch(error) { return {error:error instanceof Error&&!('cause' in error)?error.message:"Verbindung konnte nicht geprüft werden."}; }
}
