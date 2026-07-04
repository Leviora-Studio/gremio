// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getCurrentUser } from "@/lib/auth";
import { getOverviewItems } from "@/lib/inventory-overview";
import { conditionLabel } from "@/lib/inventory-condition";
import { contentDisposition } from "@/lib/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function euro(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** CSV-Export der board-übergreifenden Gesamtübersicht (nur Admin). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { items, total } = await getOverviewItems();
  const header = [
    "Inventar",
    "Inventarnummer",
    "Seriennummer",
    "Bezeichnung",
    "Zustand",
    "Kaufdatum",
    "Händler",
    "Kaufpreis (EUR)",
  ];
  const rows = items.map((it) => [
    it.boardName,
    it.number,
    it.serialNumber,
    it.name,
    conditionLabel(it.condition),
    it.purchaseDate,
    it.vendor,
    euro(it.price),
  ]);
  const totalRow = ["", "", "", "Gesamtwert", "", "", "", euro(total)];

  const csv =
    "﻿" +
    [header, ...rows, totalRow]
      .map((r) => r.map(csvCell).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(
        "inventar-gesamtuebersicht.csv",
        "attachment",
      ),
      "Cache-Control": "no-store",
    },
  });
}
