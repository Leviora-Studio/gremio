// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { OwnerSettings } from "@/components/ownership/OwnerSettings";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryBoards, users } from "@/lib/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setInventoryBoardPublicConfirmedAction } from "./actions";

export default async function AdminInventoryPage() {
  await requireAdmin();
  const boards = await db
    .select({
      id: inventoryBoards.id,
      name: inventoryBoards.name,
      isPublic: inventoryBoards.isPublic,
      ownerName: users.username,
    })
    .from(inventoryBoards)
    .leftJoin(users, eq(users.id, inventoryBoards.ownerId)).where(activeRows.inventoryBoards)
    .orderBy(asc(inventoryBoards.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Inventar — öffentliche Sichtbarkeit
          </h2>
          <p className="text-sm text-slate-500">
            Öffentlich freigegebene Inventare erscheinen unter{" "}
            <code>/inventar</code> für alle (mit Such-/Filterfunktion und der
            Möglichkeit, einen Gegenstand anzufragen). Öffentlich sichtbar sind
            nur Bezeichnung, Kategorie und Entleihstatus — keine Inventar-/
            Seriennummer, Standort, Einzelpreise, Belege, Halter oder Verträge.
          </p>
        </div>
        <Link href="/admin/inventar/gesamt" className="btn-secondary shrink-0">
          Gesamtübersicht
        </Link>
      </div>

      {boards.length === 0 && (
        <p className="text-sm text-slate-500">Noch keine Inventare angelegt.</p>
      )}

      <div className="space-y-2">
        {boards.map((b) => (
          <div
            key={b.id}
            className="flex flex-wrap items-start justify-between gap-5 rounded border border-slate-200 px-4 py-3"
          >
            <div>
              <div className="font-medium text-slate-800">{b.name}</div>
              <div className="text-xs text-slate-500">
                Eigentümer verwalten
              </div>
              <div className="mt-3"><OwnerSettings kind="inventory" id={b.id}/></div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  b.isPublic
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {b.isPublic ? "öffentlich" : "privat"}
              </span>
              <ConfirmButton action={setInventoryBoardPublicConfirmedAction.bind(null,b.id,!b.isPublic)} label={b.isPublic?"Verbergen":"Öffentlich machen"} title={b.isPublic?"Inventar verbergen":"Inventar öffentlich machen"} message={b.isPublic?"Das Inventar wird aus der öffentlichen Ansicht entfernt.":"Das Inventar wird mit seinen öffentlich freigegebenen Angaben sichtbar."} confirmLabel="Bestätigen" requireTyped={b.isPublic?"VERBERGEN":"ÖFFENTLICH"} className="btn-secondary px-3 py-1 text-sm"/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
