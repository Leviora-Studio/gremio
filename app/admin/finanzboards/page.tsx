// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeBoards, financeTemplates, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { OwnerSettings } from "@/components/ownership/OwnerSettings";
import { FilterableList } from "@/components/FilterableList";
import { CreateFinanceBoardForm } from "@/components/finance/CreateFinanceBoardForm";
import {
  deleteFinanceBoardAdminAction,
} from "@/app/finanzen/actions";

export default async function AdminFinanceBoardsPage() {
  await requireAdmin();
  const rows = await db
    .select({
      id: financeBoards.id,
      name: financeBoards.name,
      ownerId: financeBoards.ownerId,
      ownerName: users.username,
    })
    .from(financeBoards)
    .leftJoin(users, eq(users.id, financeBoards.ownerId)).where(activeRows.financeBoards)
    .orderBy(financeBoards.name);
  const templates = await db.select({ id: financeTemplates.id, name: financeTemplates.name })
    .from(financeTemplates).where(activeRows.financeTemplates).orderBy(asc(financeTemplates.name));

  return (
    <div className="max-w-6xl space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Finanzübersicht anlegen</h2>
        <CreateFinanceBoardForm templates={templates} />
      </section>
      <h2 className="text-lg font-semibold">Alle Finanzboards ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine Finanzboards.</p>
      ) : (
        <FilterableList
          placeholder="Finanzboard suchen…"
          emptyText="Keine passenden Finanzboards."
          items={rows.map((b) => ({
            key: b.id,
            search: `${b.name} ${b.ownerName ?? ""}`,
            element: (
              <div className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/finanzen/${b.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {b.name}
                    </Link>
                    <span className="ml-2 text-sm text-slate-500">
                      Eigentümer siehe unten
                    </span>
                  </div>
                  <div className="w-full space-y-4 border-t border-slate-100 pt-4">
                    <OwnerSettings kind="finance" id={b.id}/>
                    <DeleteConfirm
                      action={deleteFinanceBoardAdminAction.bind(null, b.id)}
                      confirmName={b.name}
                      buttonLabel="Löschen"
                      compact
                      title={`Finanzboard „${b.name}" löschen`}
                      message="Die Finanzübersicht inkl. Haushaltsplan wird unwiderruflich gelöscht."
                    />
                  </div>
                </div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
