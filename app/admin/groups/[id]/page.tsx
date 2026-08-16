// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, userGroups, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { Avatar } from "@/components/Avatar";
import { SubmitButton } from "@/components/SubmitButton";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { Select } from "@/components/Select";
import { RenameGroupForm } from "@/components/admin/RenameGroupForm";
import { addMemberAction, removeMemberAction } from "../actions";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const groupId = Number(id);
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) notFound();

  const members = await db
    .select({
      id: users.id,
      username: users.username,
      avatarPath: users.avatarPath,
    })
    .from(userGroups)
    .innerJoin(users, eq(users.id, userGroups.userId))
    .where(eq(userGroups.groupId, groupId))
    .orderBy(users.username);

  const memberIds = new Set(members.map((m) => m.id));
  const allUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .orderBy(users.username);
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div className="space-y-6">
      <Link href="/admin/groups" className="text-sm text-brand-600">
        ← Zurück zu Gruppen
      </Link>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Gruppe bearbeiten</h2>
        <RenameGroupForm
          groupId={group.id}
          name={group.name}
          description={group.description}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Mitglieder ({members.length})
        </h2>

        <form
          action={addMemberAction.bind(null, groupId)}
          className="flex flex-wrap items-center gap-2"
        >
          <Select
            name="userId"
            className="w-64"
            placeholder="Nutzer auswählen…"
            searchable
            searchPlaceholder="Nutzer suchen…"
            options={candidates.map((u) => ({
              value: String(u.id),
              label: u.username,
            }))}
          />
          <SubmitButton className="btn-primary px-3 py-1.5">
            Hinzufügen
          </SubmitButton>
          {candidates.length === 0 && (
            <span className="text-sm text-slate-500">
              Alle Nutzer sind bereits Mitglied.
            </span>
          )}
        </form>

        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="card flex items-center justify-between p-3"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  username={m.username}
                  src={m.avatarPath ? `/api/avatar/${m.id}` : null}
                  size={32}
                />
                <span className="font-medium">{m.username}</span>
              </div>
              <DeleteConfirm
                action={removeMemberAction.bind(null, groupId, m.id)}
                requireWord={false}
                buttonLabel="Entfernen"
                buttonClassName="btn-secondary px-3 py-1.5"
                title={`„${m.username}" aus der Gruppe entfernen`}
                message="Der Nutzer verliert dadurch den Gruppen-Zugriff auf alle für diese Gruppe freigegebenen Boards und Finanzübersichten."
              />
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-slate-500">Noch keine Mitglieder.</p>
          )}
        </div>
      </section>
    </div>
  );
}
