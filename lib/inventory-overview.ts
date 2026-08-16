// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryBoards,
  inventoryItems,
  inventoryOverviewConfig,
} from "@/lib/db/schema";

/** Singleton-Konfiguration (Mindestpreis in Cent); legt sie bei Bedarf an. */
export async function getOverviewMinPrice(): Promise<number> {
  const [row] = await db
    .select()
    .from(inventoryOverviewConfig)
    .where(eq(inventoryOverviewConfig.id, 1))
    .limit(1);
  if (row) return row.minPrice;
  await db
    .insert(inventoryOverviewConfig)
    .values({ id: 1, minPrice: 0 })
    .onConflictDoNothing();
  return 0;
}

export async function setOverviewMinPrice(cents: number): Promise<void> {
  await db
    .insert(inventoryOverviewConfig)
    .values({ id: 1, minPrice: cents })
    .onConflictDoUpdate({
      target: inventoryOverviewConfig.id,
      set: { minPrice: cents },
    });
}

export async function setBoardInOverview(
  boardId: number,
  include: boolean,
): Promise<void> {
  await db
    .update(inventoryBoards)
    .set({ includeInOverview: include })
    .where(eq(inventoryBoards.id, boardId));
}

export type OverviewItem = {
  itemId: number;
  boardId: number;
  boardName: string;
  number: string | null;
  serialNumber: string | null;
  name: string;
  condition: string;
  price: number | null;
  purchaseDate: string | null;
  vendor: string | null;
};

/**
 * Alle Artikel (einzeln, ohne Summe zwischendrin) aus den einbezogenen Boards
 * mit Preis ≥ Mindestpreis. Für das Anlagenverzeichnis (gesetzliche Nachweise).
 */
export async function getOverviewItems(): Promise<{
  items: OverviewItem[];
  total: number;
  minPrice: number;
}> {
  const minPrice = await getOverviewMinPrice();
  const rows = await db
    .select({
      itemId: inventoryItems.id,
      boardId: inventoryItems.boardId,
      boardName: inventoryBoards.name,
      number: inventoryItems.number,
      serialNumber: inventoryItems.serialNumber,
      name: inventoryItems.name,
      condition: inventoryItems.condition,
      price: inventoryItems.price,
      purchaseDate: inventoryItems.purchaseDate,
      vendor: inventoryItems.vendor,
    })
    .from(inventoryItems)
    .innerJoin(
      inventoryBoards,
      eq(inventoryBoards.id, inventoryItems.boardId),
    )
    .where(
      and(
        eq(inventoryBoards.includeInOverview, true),
        gte(inventoryItems.price, minPrice),
      ),
    )
    .orderBy(asc(inventoryBoards.name), asc(inventoryItems.name));

  const total = rows.reduce((s, r) => s + (r.price ?? 0), 0);
  return { items: rows, total, minPrice };
}
