// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPublicBoardData,
  getPublicInventoryBoardById,
} from "@/lib/inventory-public";
import { PublicInventoryBoard } from "@/components/inventory/PublicInventoryBoard";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";

export default async function PublicInventoryBoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const board = await getPublicInventoryBoardById(Number(id));
  if (!board) notFound();
  const { publicFields, items, options } = await getPublicBoardData(board.id);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <LiveRefresh src={`/api/inventar/${board.id}/stream`} />
      <Link href="/inventar" className="text-sm text-brand-600">
        ← Inventar
      </Link>
      <h1 className="text-2xl font-bold">{board.name}</h1>
      {board.description && (
        <p className="mt-1 text-slate-600">{board.description}</p>
      )}

      <div className="mt-6">
        <PublicInventoryBoard
          publicFields={publicFields}
          items={items}
          options={options}
        />
      </div>
    </main>
  );
}
