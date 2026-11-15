// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeBoards } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getAccounts } from "@/lib/accounts";
import { CreateAccountForm } from "@/components/admin/CreateAccountForm";
import { AccountRow } from "@/components/admin/AccountRow";

export default async function AccountsPage() {
  await requireAdmin();
  const items = await getAccounts();
  const sources = await db.select({id:financeBoards.id,name:financeBoards.name}).from(financeBoards).where(activeRows.financeBoards).orderBy(asc(financeBoards.name));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Konten</h2>
        <p className="text-sm text-slate-500">
          Ordne jedem Konto ein Finanzboard zu. Dessen Haushaltsplan liefert die
          auswählbaren Haushaltstitel bei der Einplanung auf Antragsboards.
        </p>
      </div>

      <CreateAccountForm financeBoards={sources} />

      {items.length === 0 && (
        <p className="text-sm text-slate-500">Noch keine Konten angelegt.</p>
      )}
      {items.map((a) => (
        <AccountRow key={a.id} account={a} financeBoards={sources} />
      ))}
    </div>
  );
}
