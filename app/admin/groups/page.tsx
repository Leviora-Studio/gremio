// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, userGroups } from "@/lib/db/schema";
import { CreateGroupForm } from "@/components/admin/CreateGroupForm";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { deleteGroupAction } from "./actions";

export default async function GroupsPage() {
  // Nicht nur im Layout: Guard in JEDEM Handler (CLAUDE.md) — Layout-Guards
  // greifen bei segmentgenauen RSC-Navigationsrequests nicht zwingend.
  await requireAdmin();

  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      members: sql<number>`count(${userGroups.userId})`,
    })
    .from(groups)
    .leftJoin(userGroups, eq(userGroups.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(groups.name);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Neue Gruppe anlegen</h2>
        <CreateGroupForm />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Gruppen ({rows.length})</h2>
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">Noch keine Gruppen.</p>
        )}
        {rows.map((g) => (
          <div
            key={g.id}
            className="card flex items-center justify-between p-4"
          >
            <div>
              <Link
                href={`/admin/groups/${g.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {g.name}
              </Link>
              <span className="ml-2 text-sm text-slate-500">
                {g.members} Mitglied(er)
              </span>
              {g.description && (
                <p className="text-sm text-slate-500">{g.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link
                href={`/admin/groups/${g.id}`}
                className="btn-secondary px-3 py-1.5"
              >
                Mitglieder
              </Link>
              <DeleteConfirm
                action={deleteGroupAction.bind(null, g.id)}
                compact
                buttonLabel="Löschen"
                buttonClassName="btn-danger px-3 py-1.5"
                title={`Gruppe „${g.name}" löschen`}
                message="Die Gruppe wird gelöscht; Mitgliedschaften und Board-/Finanzboard-Freigaben an diese Gruppe entfallen."
              />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
