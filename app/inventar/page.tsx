// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { getPublicInventoryBoards } from "@/lib/inventory-public";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventar — Ausleihe" };

export default async function PublicInventoryHome() {
  const boards = await getPublicInventoryBoards();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <PublicNav current="inventar" />
      <h1 className="text-2xl font-bold">Inventar &amp; Ausleihe</h1>
      <p className="mb-6 mt-2 text-slate-600">
        Stöbere im verfügbaren Inventar und frage einen Gegenstand zur Ausleihe
        an. Nach dem Absenden erhältst du einen Link, über den du den Status
        verfolgen kannst.
      </p>

      {boards.length === 0 ? (
        <div className="card p-6 text-slate-600">
          Aktuell ist kein Inventar öffentlich verfügbar.
        </div>
      ) : (
        <div className="space-y-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/inventar/${b.id}`}
              className="card flex w-full flex-col gap-1 p-4 transition hover:border-brand-300"
            >
              <span className="font-semibold text-slate-800">{b.name}</span>
              {b.description && (
                <span className="line-clamp-2 text-sm text-slate-500">
                  {b.description}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
