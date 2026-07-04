// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryItemCategories,
  inventoryItems,
  inventoryNumbering,
  inventoryOptions,
  type InventoryItem,
  type InventoryNumbering,
  type InventoryOption,
} from "@/lib/db/schema";
import { buildCardNumber } from "@/lib/numbering";
import { getActiveLoanMap, getOpenDefectCountMap } from "@/lib/inventory-loans";

// Drizzle-Transaktionshandle (für „in bestehender Transaktion mitlaufen").
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const OPTION_KINDS = ["category", "location", "loan_status"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

// ---------------------------------------------------------------------------
// Optionen (erweiterbare Selects: Kategorie / Standort / Entleihstatus)
// ---------------------------------------------------------------------------

export type GroupedOptions = Record<OptionKind, InventoryOption[]>;

/** Alle Optionen eines Boards, nach Art gruppiert und alphabetisch sortiert. */
export async function getInventoryOptions(
  boardId: number,
): Promise<GroupedOptions> {
  const rows = await db
    .select()
    .from(inventoryOptions)
    .where(eq(inventoryOptions.boardId, boardId))
    .orderBy(asc(inventoryOptions.name));
  return {
    category: rows.filter((r) => r.kind === "category"),
    location: rows.filter((r) => r.kind === "location"),
    loan_status: rows.filter((r) => r.kind === "loan_status"),
  };
}

/** Option anlegen (idempotent: existiert sie schon, wird sie zurückgegeben). */
export async function addInventoryOption(
  boardId: number,
  kind: OptionKind,
  name: string,
): Promise<InventoryOption> {
  const trimmed = name.trim();
  const [existing] = await db
    .select()
    .from(inventoryOptions)
    .where(
      and(
        eq(inventoryOptions.boardId, boardId),
        eq(inventoryOptions.kind, kind),
        eq(inventoryOptions.name, trimmed),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(inventoryOptions)
    .values({ boardId, kind, name: trimmed })
    .returning();
  return row;
}

/** Option löschen (Gegenstands-Referenzen werden per FK auf NULL gesetzt). */
export async function deleteInventoryOption(optionId: number): Promise<void> {
  await db.delete(inventoryOptions).where(eq(inventoryOptions.id, optionId));
}

export async function getInventoryOptionById(
  optionId: number,
): Promise<InventoryOption | undefined> {
  if (!Number.isInteger(optionId)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryOptions)
    .where(eq(inventoryOptions.id, optionId))
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Auto-Inventarnummer (wie board_numbering)
// ---------------------------------------------------------------------------

export async function getInventoryNumbering(
  boardId: number,
): Promise<InventoryNumbering | undefined> {
  const [row] = await db
    .select()
    .from(inventoryNumbering)
    .where(eq(inventoryNumbering.boardId, boardId))
    .limit(1);
  return row;
}

/** Zieht atomar die nächste Nummer und schreibt sie auf den Gegenstand. */
async function assignInventoryNumberTx(
  tx: Tx,
  boardId: number,
  itemId: number,
): Promise<string | null> {
  const [cfg] = await tx
    .update(inventoryNumbering)
    .set({ next: sql`${inventoryNumbering.next} + 1` })
    .where(
      and(
        eq(inventoryNumbering.boardId, boardId),
        eq(inventoryNumbering.enabled, true),
      ),
    )
    .returning({
      assigned: sql<number>`${inventoryNumbering.next} - 1`,
      prefix: inventoryNumbering.prefix,
      year: inventoryNumbering.year,
      code: inventoryNumbering.code,
      separator: inventoryNumbering.separator,
      padding: inventoryNumbering.padding,
    });
  if (!cfg) return null; // Nummerierung aus
  const number = buildCardNumber(cfg, cfg.assigned);
  await tx
    .update(inventoryItems)
    .set({ number })
    .where(eq(inventoryItems.id, itemId));
  return number;
}

// ---------------------------------------------------------------------------
// Gegenstände
// ---------------------------------------------------------------------------

export type InventoryAvailability = "available" | "lent" | "not_lendable";

export type InventoryItemView = InventoryItem & {
  categoryIds: number[];
  categoryNames: string[];
  locationName: string | null;
  loanStatusName: string | null;
  // abgeleitet aus dem laufenden Entleihvorgang (null = nicht entliehen)
  activeBorrower: string | null;
  activeUntil: string | null;
  openDefects: number;
  // automatischer Status: nicht entleihbar / verfügbar / entliehen
  availability: InventoryAvailability;
};

function availabilityOf(
  lendable: boolean,
  activeBorrower: string | null,
): InventoryAvailability {
  if (!lendable) return "not_lendable";
  return activeBorrower != null ? "lent" : "available";
}

/**
 * Alle Gegenstände eines Boards inkl. aufgelöster Options-Namen. `conditions`
 * filtert auf den Zustand (z. B. ['active'] fürs Board, ['defect','lost'] fürs
 * Archiv); ohne Angabe werden alle Zustände geliefert.
 */
export async function listInventoryItems(
  boardId: number,
  conditions?: string[],
): Promise<InventoryItemView[]> {
  const items = await db
    .select()
    .from(inventoryItems)
    .where(
      conditions && conditions.length
        ? and(
            eq(inventoryItems.boardId, boardId),
            inArray(inventoryItems.condition, conditions),
          )
        : eq(inventoryItems.boardId, boardId),
    )
    .orderBy(asc(inventoryItems.name), asc(inventoryItems.id));
  if (!items.length) return [];

  const opts = await db
    .select()
    .from(inventoryOptions)
    .where(eq(inventoryOptions.boardId, boardId));
  const optName = new Map(opts.map((o) => [o.id, o.name]));

  const itemIds = items.map((i) => i.id);
  const cats = await db
    .select()
    .from(inventoryItemCategories)
    .where(inArray(inventoryItemCategories.itemId, itemIds));
  const byItem = new Map<number, number[]>();
  for (const c of cats) {
    const arr = byItem.get(c.itemId) ?? [];
    arr.push(c.optionId);
    byItem.set(c.itemId, arr);
  }

  const [activeLoans, defectCounts] = await Promise.all([
    getActiveLoanMap(itemIds),
    getOpenDefectCountMap(itemIds),
  ]);

  return items.map((it) => {
    const categoryIds = byItem.get(it.id) ?? [];
    const loan = activeLoans.get(it.id);
    return {
      ...it,
      categoryIds,
      categoryNames: categoryIds
        .map((id) => optName.get(id))
        .filter((n): n is string => !!n),
      locationName: it.locationId ? optName.get(it.locationId) ?? null : null,
      loanStatusName: it.loanStatusId
        ? optName.get(it.loanStatusId) ?? null
        : null,
      activeBorrower: loan?.borrower ?? null,
      activeUntil: loan?.endDate ?? null,
      openDefects: defectCounts.get(it.id) ?? 0,
      availability: availabilityOf(it.lendable, loan?.borrower ?? null),
    };
  });
}

export async function getInventoryItemById(
  id: number,
): Promise<InventoryItem | undefined> {
  if (!Number.isInteger(id)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, id))
    .limit(1);
  return row;
}

/** Einzelner Gegenstand inkl. Kategorien, Options-Namen und laufendem Vorgang. */
export async function getInventoryItemView(
  id: number,
): Promise<InventoryItemView | undefined> {
  const item = await getInventoryItemById(id);
  if (!item) return undefined;
  const opts = await db
    .select()
    .from(inventoryOptions)
    .where(eq(inventoryOptions.boardId, item.boardId));
  const optName = new Map(opts.map((o) => [o.id, o.name]));
  const cats = await db
    .select()
    .from(inventoryItemCategories)
    .where(eq(inventoryItemCategories.itemId, id));
  const categoryIds = cats.map((c) => c.optionId);
  const [loanMap, defectMap] = await Promise.all([
    getActiveLoanMap([id]),
    getOpenDefectCountMap([id]),
  ]);
  const loan = loanMap.get(id);
  return {
    ...item,
    categoryIds,
    categoryNames: categoryIds
      .map((cid) => optName.get(cid))
      .filter((n): n is string => !!n),
    locationName: item.locationId ? optName.get(item.locationId) ?? null : null,
    loanStatusName: item.loanStatusId
      ? optName.get(item.loanStatusId) ?? null
      : null,
    activeBorrower: loan?.borrower ?? null,
    activeUntil: loan?.endDate ?? null,
    openDefects: defectMap.get(id) ?? 0,
    availability: availabilityOf(item.lendable, loan?.borrower ?? null),
  };
}

export type ItemInput = {
  name: string;
  number: string | null;
  serialNumber: string | null;
  condition: string;
  conditionNote: string | null;
  lendable: boolean;
  locationId: number | null;
  price: number | null;
  purchaseDate: string | null;
  vendor: string | null;
  notes: string | null;
  categoryIds: number[];
};

/**
 * Gegenstand anlegen. Ist die Nummerierung aktiv und keine Nummer angegeben,
 * wird automatisch eine vergeben (atomar in derselben Transaktion).
 */
export async function createInventoryItem(
  boardId: number,
  creatorId: number,
  data: ItemInput,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .insert(inventoryItems)
      .values({
        boardId,
        name: data.name,
        number: data.number,
        serialNumber: data.serialNumber,
        condition: data.condition,
        conditionNote: data.conditionNote,
        lendable: data.lendable,
        locationId: data.locationId,
        price: data.price,
        purchaseDate: data.purchaseDate,
        vendor: data.vendor,
        notes: data.notes,
        creatorUserId: creatorId,
      })
      .returning({ id: inventoryItems.id });

    if (!data.number) {
      await assignInventoryNumberTx(tx, boardId, item.id);
    }
    if (data.categoryIds.length) {
      await tx.insert(inventoryItemCategories).values(
        data.categoryIds.map((optionId) => ({ itemId: item.id, optionId })),
      );
    }
    return item.id;
  });
}

// Nur sichtbare Felder werden gepatcht — `undefined` lässt das Feld unberührt,
// damit am Board ausgeblendete Felder beim Speichern nicht überschrieben werden.
export type ItemPatch = Partial<Omit<ItemInput, "categoryIds">> & {
  categoryIds?: number[];
};

export async function updateInventoryItem(
  id: number,
  patch: ItemPatch,
): Promise<void> {
  const { categoryIds, ...fields } = patch;
  await db.transaction(async (tx) => {
    await tx
      .update(inventoryItems)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(inventoryItems.id, id));
    if (categoryIds !== undefined) {
      await tx
        .delete(inventoryItemCategories)
        .where(eq(inventoryItemCategories.itemId, id));
      if (categoryIds.length) {
        await tx.insert(inventoryItemCategories).values(
          categoryIds.map((optionId) => ({ itemId: id, optionId })),
        );
      }
    }
  });
}

export async function deleteInventoryItem(id: number): Promise<void> {
  await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
}
