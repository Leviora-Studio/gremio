// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { moveToTrash } from "@/lib/trash";
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts, financeBoards } from "@/lib/db/schema";
import { isForeignKeyViolation } from "@/lib/db-errors";
import { requireAdmin } from "@/lib/auth";

export type State = { error?: string; success?: string };

const nameSchema = z.object({
  name: z.string().min(1, "Bezeichnung erforderlich.").max(120),
});

export async function createAccountAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const exists = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, parsed.data.name))
    .limit(1);
  if (exists.length) return { error: "Dieses Konto gibt es bereits." };

  const source = await parseFinanceBoard(formData.get("financeBoardId"));
  if ("error" in source) return source;
  const [row] = await db.select({ m: max(accounts.position) }).from(accounts).where(activeRows.accounts);
  await db
    .insert(accounts)
    .values({ name: parsed.data.name, financeBoardId: source.id, position: (row?.m ?? -1) + 1 });
  revalidatePath("/admin/accounts");
  return { success: `Konto „${parsed.data.name}" angelegt.` };
}

export async function renameAccountAction(
  accountId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireAdmin();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const clash = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, parsed.data.name))
    .limit(1);
  if (clash[0] && clash[0].id !== accountId) {
    return { error: "Diese Bezeichnung ist bereits vergeben." };
  }
  await db
    .update(accounts)
    .set({ name: parsed.data.name })
    .where(eq(accounts.id, accountId));
  revalidatePath("/admin/accounts");
  return { success: "Umbenannt." };
}

export async function deleteAccountAction(accountId: number, confirmation?: unknown): Promise<State | void> {
  const user=await requireAdmin();
  try { await moveToTrash(user, "account", accountId, confirmation); }
  catch(error) { return {error:error instanceof Error ? error.message : "Verschieben in den Papierkorb fehlgeschlagen."}; }
  revalidatePath("/admin/accounts"); revalidatePath("/intern", "layout"); revalidatePath("/");
}

async function parseFinanceBoard(value: FormDataEntryValue | null): Promise<{id:number|null}|{error:string}> {
  if(value == null || value === "")return {id:null};
  const id=typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if(!Number.isSafeInteger(id)||id<1||id>2147483647||!(await db.select({id:financeBoards.id}).from(financeBoards).where(trashAnd(activeRows.financeBoards, eq(financeBoards.id,id)))).length)return {error:"Bitte ein vorhandenes Finanzboard auswählen."};
  return {id};
}
export async function assignAccountFinanceBoardAction(accountId:number,_prev:State,formData:FormData):Promise<State> {
  await requireAdmin();
  const source=await parseFinanceBoard(formData.get("financeBoardId"));
  if("error" in source)return source;
  try {
    const rows=await db.update(accounts).set({financeBoardId:source.id}).where(eq(accounts.id,accountId)).returning({id:accounts.id});
    if(!rows.length)return {error:"Konto nicht gefunden."};
  } catch(error) { if(isForeignKeyViolation(error))return {error:"Das Finanzboard wurde zwischenzeitlich gelöscht. Bitte erneut auswählen."}; throw error; }
  revalidatePath("/admin/accounts"); revalidatePath("/intern", "layout");
  return {success:"Finanzboard-Zuordnung gespeichert."};
}
