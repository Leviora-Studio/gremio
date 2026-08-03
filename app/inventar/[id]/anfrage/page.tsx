// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import {
  getAvailableGroupUnits,
  getAvailableItemQuantity,
  getInventoryItemById,
  listInventoryGroupNames,
} from "@/lib/inventory-items";
import {
  PublicLoanRequestForm,
  type LoanRequestTarget,
} from "@/components/inventory/PublicLoanRequestForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ausleihe anfragen — Inventar" };

/**
 * Öffentliche Ausleih-Anfrage als EIGENE SEITE (kein Popup) — bewusst im
 * gleichen Aufbau wie „Antrag einreichen" (`app/page.tsx`).
 *
 * Ziel kommt aus der Query: `?group=<Obergruppe>` oder `?item=<id>`. Beides wird
 * hier serverseitig gegen das öffentliche Board geprüft — die Query ist
 * nutzerkontrolliert und darf nichts freischalten, was die Liste nicht zeigt.
 */
export default async function PublicLoanRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const board = await getPublicInventoryBoardById(Number(id));
  if (!board) notFound();

  const groupParam = typeof sp.group === "string" ? sp.group.trim() : "";
  const itemParam = typeof sp.item === "string" ? Number(sp.item) : NaN;

  let target: LoanRequestTarget;
  if (groupParam) {
    // Nur real existierende Obergruppen dieses Boards zulassen.
    const groups = await listInventoryGroupNames(board.id);
    if (!groups.includes(groupParam)) notFound();
    const { available } = await getAvailableGroupUnits(board.id, groupParam, 0);
    target = {
      kind: "group",
      name: groupParam,
      groupName: groupParam,
      itemId: null,
      available,
    };
  } else if (Number.isInteger(itemParam)) {
    const item = await getInventoryItemById(itemParam);
    // Gegenstand muss zu DIESEM Board gehören und öffentlich sichtbar sein
    // (entleihbar + Zustand aktiv) — sonst wie „nicht vorhanden" behandeln.
    if (
      !item ||
      item.boardId !== board.id ||
      !item.lendable ||
      item.condition !== "active"
    ) {
      notFound();
    }
    target = {
      kind: item.quantity > 1 ? "bulk" : "single",
      name: item.name,
      groupName: null,
      itemId: item.id,
      available: await getAvailableItemQuantity(item.id),
    };
  } else {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <Link href={`/inventar/${board.id}`} className="text-sm text-brand-600">
          ← {board.name}
        </Link>
        <h1 className="text-2xl font-bold">Ausleihe anfragen</h1>
      </div>
      <p className="mb-6 text-slate-600">
        Du fragst <strong className="text-slate-800">{target.name}</strong> an.
        Nach dem Absenden erhältst du einen Link, über den du den Status
        verfolgen kannst.
      </p>

      {target.available === 0 ? (
        <div className="card p-6 text-slate-600">
          Von diesem Gegenstand ist aktuell nichts verfügbar. Schau später noch
          einmal vorbei.
        </div>
      ) : (
        <div className="card p-6">
          <PublicLoanRequestForm boardId={board.id} target={target} />
        </div>
      )}
    </main>
  );
}
