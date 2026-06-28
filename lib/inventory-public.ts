// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryBoards, type InventoryBoard } from "@/lib/db/schema";
import { getVisibleInventoryFieldKeys } from "@/lib/inventory-fields";
import {
  getInventoryOptions,
  listInventoryItems,
  type InventoryAvailability,
} from "@/lib/inventory-items";

// Öffentlich zeigbare Felder — bewusste Whitelist. NICHT enthalten: Preis,
// Händler, Kaufdatum, Belege, „aktuell bei" (Person) und Verträge. Die
// Verfügbarkeit (verfügbar / entliehen bis) wird immer angezeigt.
export const PUBLIC_INVENTORY_FIELD_KEYS = [
  "number",
  "category",
  "location",
] as const;

export type PublicInventoryItem = {
  id: number;
  name: string;
  number: string | null;
  categoryIds: number[];
  categoryNames: string[];
  locationId: number | null;
  locationName: string | null;
  availability: InventoryAvailability; // available | lent (nie not_lendable öffentlich)
  lentUntil: string | null; // nur das Enddatum — KEINE Person
};

export type PublicOpt = { id: number; name: string };

export async function getPublicInventoryBoards(): Promise<InventoryBoard[]> {
  return db
    .select()
    .from(inventoryBoards)
    .where(eq(inventoryBoards.isPublic, true))
    .orderBy(asc(inventoryBoards.name));
}

export async function getPublicInventoryBoardById(
  boardId: number,
): Promise<InventoryBoard | undefined> {
  if (!Number.isInteger(boardId)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryBoards)
    .where(eq(inventoryBoards.id, boardId))
    .limit(1);
  return row && row.isPublic ? row : undefined;
}

/**
 * Öffentliche Item-Liste eines freigegebenen Boards: nur Whitelist-Felder, der
 * Entleihstatus reduziert auf „verfügbar / entliehen bis <Datum>" (ohne Person).
 */
export async function getPublicBoardData(boardId: number): Promise<{
  publicFields: string[];
  items: PublicInventoryItem[];
  options: { category: PublicOpt[]; location: PublicOpt[] };
}> {
  const [visible, full, options] = await Promise.all([
    getVisibleInventoryFieldKeys(boardId),
    listInventoryItems(boardId),
    getInventoryOptions(boardId),
  ]);
  const publicFields = PUBLIC_INVENTORY_FIELD_KEYS.filter((k) =>
    visible.has(k),
  );
  // Nicht-entleihbare Gegenstände sind öffentlich gar nicht sichtbar.
  const items: PublicInventoryItem[] = full
    .filter((it) => it.lendable)
    .map((it) => ({
      id: it.id,
      name: it.name,
      number: it.number,
      categoryIds: it.categoryIds,
      categoryNames: it.categoryNames,
      locationId: it.locationId,
      locationName: it.locationName,
      availability: it.availability,
      lentUntil: it.activeUntil,
    }));
  const toOpts = (rows: { id: number; name: string }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));
  return {
    publicFields,
    items,
    options: {
      category: toOpts(options.category),
      location: toOpts(options.location),
    },
  };
}
