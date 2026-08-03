// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getCurrentUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import {
  listInventoryItems,
  type InventoryItemView,
} from "@/lib/inventory-items";
import { conditionLabel } from "@/lib/inventory-condition";
import { contentDisposition } from "@/lib/attachments";
import { buildCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function euro(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

function availabilityText(it: InventoryItemView): string {
  if (it.condition !== "active") return conditionLabel(it.condition);
  if (!it.lendable) return "nicht entleihbar";
  return it.activeBorrower != null ? "entliehen" : "verfügbar";
}

const COMPARATORS: Record<
  string,
  (a: InventoryItemView, b: InventoryItemView) => number
> = {
  name: (a, b) => a.name.localeCompare(b.name, "de"),
  number: (a, b) => (a.number ?? "").localeCompare(b.number ?? "", "de"),
  category: (a, b) =>
    (a.categoryNames[0] ?? "").localeCompare(b.categoryNames[0] ?? "", "de"),
  location: (a, b) =>
    (a.locationName ?? "").localeCompare(b.locationName ?? "", "de"),
  price: (a, b) => (b.price ?? -1) - (a.price ?? -1), // teuerste zuerst
  purchase_date: (a, b) =>
    (a.purchaseDate ?? "").localeCompare(b.purchaseDate ?? ""),
  condition: (a, b) => a.condition.localeCompare(b.condition),
};

/** CSV-Export der gesamten Inventarliste eines Boards (nach Sortierung). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const boardId = Number(id);
  const board = await getInventoryBoardById(boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }

  const sort = new URL(request.url).searchParams.get("sort") ?? "name";
  const cmp = COMPARATORS[sort] ?? COMPARATORS.name;
  const items = (await listInventoryItems(boardId)).sort(cmp);

  const header = [
    "Inventarnummer",
    "Seriennummer",
    "Bezeichnung",
    "Kategorien",
    "Standort",
    "Zustand",
    "Entleihbar",
    "Verfügbarkeit",
    "Aktuell bei",
    "Einzelpreis (EUR)",
    "Kaufdatum",
    "Händler",
    "Notizen",
  ];
  const rows = items.map((it) => [
    it.number,
    it.serialNumber,
    it.name,
    it.categoryNames.join(", "),
    it.locationName,
    conditionLabel(it.condition),
    it.lendable ? "ja" : "nein",
    availabilityText(it),
    it.activeBorrower,
    euro(it.price),
    it.purchaseDate,
    it.vendor,
    it.notes,
  ]);

  // BOM + Semikolon → Excel (DE) öffnet Umlaute und Spalten korrekt.
  const csv = buildCsv([header, ...rows]);

  const safeName = board.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "inventar";
  const filename = `inventar-${safeName}-${sort}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename, "attachment"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
