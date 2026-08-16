// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { UserRow } from "@/components/admin/UserRow";
import { FilterableList } from "@/components/FilterableList";

export default async function UsersPage() {
  const me = await requireAdmin();
  const allUsers = await db.select().from(users).orderBy(users.username);
  const [adminRow] = await db
    .select({ c: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  const adminCount = adminRow?.c ?? 0;

  return (
    <div className="space-y-6">
      <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">
        Konten werden zentral über das SSO verwaltet. Nutzer erscheinen hier
        automatisch nach ihrem ersten Login. Hier legst du nur Rollen und den
        App-Zugang (aktiv/inaktiv) fest.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nutzer ({allUsers.length})</h2>
        {allUsers.length === 0 ? (
          <p className="text-sm text-slate-500">
            Noch keine Nutzer — sobald sich jemand per SSO anmeldet, erscheint er
            hier.
          </p>
        ) : (
          <FilterableList
            placeholder="Nutzer suchen…"
            emptyText="Keine passenden Nutzer."
            items={allUsers.map((u) => ({
              key: u.id,
              search: `${u.username} ${u.name ?? ""} ${u.email ?? ""}`,
              element: (
                <UserRow
                  user={{
                    id: u.id,
                    username: u.username,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    isActive: u.isActive,
                    avatarPath: u.avatarPath,
                  }}
                  meId={me.id}
                  adminCount={adminCount}
                />
              ),
            }))}
          />
        )}
      </section>
    </div>
  );
}
