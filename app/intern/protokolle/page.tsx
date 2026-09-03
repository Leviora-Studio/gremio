// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAccessibleProtocolAreas } from "@/lib/protocols";

export const metadata = { title: "Protokolle — Gremio" };

export default async function ProtocolAreasPage() {
  const user = await requireUser();
  const areas = await getAccessibleProtocolAreas(user);
  const ownerIds = [...new Set(areas.map((area) => area.ownerId))];
  const owners = ownerIds.length
    ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ownerIds))
    : [];
  const ownerNames = new Map(owners.map((owner) => [owner.id, owner.username]));
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Protokolle</h1>
          <p className="text-sm text-slate-500">Eigenständige Protokollbereiche mit Nextcloud als alleiniger Dateiablage.</p>
        </div>
        <Link href="/intern/protokolle/neu" className="btn-primary">Neuer Protokollbereich</Link>
      </div>
      {areas.length === 0 ? (
        <div className="card p-6 text-sm text-slate-500">Noch keine zugänglichen Protokollbereiche.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <Link key={area.id} href={`/intern/protokolle/${area.id}`} className="card p-5 transition hover:border-brand-300 hover:shadow-sm">
              <h2 className="font-semibold text-brand-700">{area.name}</h2>
              {area.description && <p className="mt-1 text-sm text-slate-600">{area.description}</p>}
              <p className="mt-3 text-xs text-slate-500">Eigentümer: {ownerNames.get(area.ownerId) ?? `#${area.ownerId}`}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
