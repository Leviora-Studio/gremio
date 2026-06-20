// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, boards, users } from "@/lib/db/schema";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { TransferOwnerForm } from "@/components/admin/TransferOwnerForm";
import { FilterableList } from "@/components/FilterableList";
import { deleteBoardAdminConfirmedAction, transferOwnerAction } from "./actions";

export default async function AdminBoardsPage() {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      ownerId: boards.ownerId,
      ownerName: users.username,
      cards: sql<number>`(select count(*) from ${cards} where ${cards.boardId} = ${boards.id})`,
    })
    .from(boards)
    .leftJoin(users, eq(users.id, boards.ownerId))
    .orderBy(boards.name);

  const allUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.username);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Alle Boards ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine Boards.</p>
      ) : (
        <FilterableList
          placeholder="Board suchen…"
          emptyText="Keine passenden Boards."
          items={rows.map((b) => ({
            key: b.id,
            search: `${b.name} ${b.ownerName ?? ""}`,
            element: (
              <div className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/intern/board/${b.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {b.name}
                    </Link>
                    <span className="ml-2 text-sm text-slate-500">
                      Eigentümer: {b.ownerName ?? "—"} · {b.cards} Karte(n)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TransferOwnerForm
                      action={transferOwnerAction.bind(null, b.id)}
                      options={allUsers.map((u) => ({
                        value: String(u.id),
                        label: u.username,
                      }))}
                      currentOwnerId={String(b.ownerId)}
                      entityLabel={`Board „${b.name}"`}
                    />
                    <DeleteConfirm
                      action={deleteBoardAdminConfirmedAction.bind(null, b.id)}
                      buttonLabel="Löschen"
                      compact
                      title={`Board „${b.name}" löschen`}
                      message="Das Board wird inkl. aller Anträge, Karten und Anhänge unwiderruflich gelöscht."
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
