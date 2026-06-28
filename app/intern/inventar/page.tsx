// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleInventoryBoards } from "@/lib/inventory";

export const metadata = { title: "Inventar — Gremio" };

export default async function InventarPage() {
  const user = await requireUser();
  const boards = await getAccessibleInventoryBoards(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventar</h1>
          <p className="text-sm text-slate-500">
            Inventar- und Entleihlisten verwalten.
          </p>
        </div>
        <Link href="/intern/inventar/neu" className="btn-primary">
          + Neues Inventar
        </Link>
      </div>

      {boards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          <p>Du hast noch kein Inventar.</p>
          <p className="mt-1 text-sm">
            Lege ein eigenes Inventar an oder lass dir eines freigeben.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/intern/inventar/${b.id}`}
              className="card flex flex-col gap-1 p-4 transition hover:border-brand-300"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{b.name}</span>
                {b.ownerId === user.id && (
                  <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
                    Eigentümer
                  </span>
                )}
                {b.isPublic && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                    Öffentlich
                  </span>
                )}
              </div>
              {b.description && (
                <p className="line-clamp-2 text-sm text-slate-500">
                  {b.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
