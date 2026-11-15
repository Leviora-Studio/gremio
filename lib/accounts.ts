// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

export type AccountOption = { id: number; name: string; financeBoardId?: number | null };

/** Alle Konto-Optionen in Anzeigereihenfolge. */
export async function getAccounts(): Promise<AccountOption[]> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, financeBoardId: accounts.financeBoardId })
    .from(accounts).where(activeRows.accounts)
    .orderBy(asc(accounts.position), asc(accounts.name));
  return rows;
}
