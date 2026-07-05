// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getCurrentUser } from "@/lib/auth";
import {
  getOverviewItems,
  type OverviewItem,
} from "@/lib/inventory-overview";
import { conditionLabel } from "@/lib/inventory-condition";
import { contentDisposition } from "@/lib/attachments";
import { buildCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function euro(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

const COMPARATORS: Record<string, (a: OverviewItem, b: OverviewItem) => number> =
  {
    board: (a, b) =>
      a.boardName.localeCompare(b.boardName, "de") ||
      a.name.localeCompare(b.name, "de"),
    name: (a, b) => a.name.localeCompare(b.name, "de"),
    number: (a, b) => (a.number ?? "").localeCompare(b.number ?? "", "de"),
    condition: (a, b) => a.condition.localeCompare(b.condition),
    purchase_date: (a, b) =>
      (a.purchaseDate ?? "").localeCompare(b.purchaseDate ?? ""),
    vendor: (a, b) => (a.vendor ?? "").localeCompare(b.vendor ?? "", "de"),
    price: (a, b) => (b.price ?? -1) - (a.price ?? -1), // teuerste zuerst
  };

/** CSV-Export des Anlagenverzeichnisses (jeder eingeloggte Nutzer; nur Ansicht). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const sort = new URL(request.url).searchParams.get("sort") ?? "board";
  const cmp = COMPARATORS[sort] ?? COMPARATORS.board;
  const { items: unsorted, total } = await getOverviewItems();
  const items = [...unsorted].sort(cmp);
  const header = [
    "Inventar",
    "Inventarnummer",
    "Bezeichnung",
    "Zustand",
    "Seriennummer",
    "Kaufdatum",
    "Händler",
    "Kaufpreis (EUR)",
  ];
  const rows = items.map((it) => [
    it.boardName,
    it.number,
    it.name,
    conditionLabel(it.condition),
    it.serialNumber,
    it.purchaseDate,
    it.vendor,
    euro(it.price),
  ]);
  const totalRow = ["", "", "Gesamtwert", "", "", "", "", euro(total)];

  const csv = buildCsv([header, ...rows, totalRow]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(
        `inventar-gesamtuebersicht-${sort}.csv`,
        "attachment",
      ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
