// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
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

  const [row] = await db.select({ m: max(accounts.position) }).from(accounts);
  await db
    .insert(accounts)
    .values({ name: parsed.data.name, position: (row?.m ?? -1) + 1 });
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

export async function deleteAccountAction(accountId: number): Promise<void> {
  await requireAdmin();
  // cards.account_id ist ON DELETE SET NULL → Karten bleiben erhalten.
  await db.delete(accounts).where(eq(accounts.id, accountId));
  revalidatePath("/admin/accounts");
}
