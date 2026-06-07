// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

export type AccountOption = { id: number; name: string };

/** Alle Konto-Optionen in Anzeigereihenfolge. */
export async function getAccounts(): Promise<AccountOption[]> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .orderBy(asc(accounts.position), asc(accounts.name));
  return rows;
}
