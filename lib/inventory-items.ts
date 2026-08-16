// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attachments,
  cards,
  inventoryAttachments,
  inventoryItemCategories,
  inventoryItems,
  inventoryLoanItems,
  inventoryLoans,
  inventoryNumbering,
  inventoryOptions,
  type InventoryItem,
  type InventoryNumbering,
  type InventoryOption,
} from "@/lib/db/schema";
import { deleteStoredFile } from "@/lib/attachments";
import { buildInventoryNumber } from "@/lib/numbering";
import {
  getActiveLoanMap,
  getFreeQuantities,
  getOpenDefectCountMap,
  updateTrackingCardTitle,
  type LoanUnit,
} from "@/lib/inventory-loans";

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
      separator: inventoryNumbering.separator,
      padding: inventoryNumbering.padding,
    });
  if (!cfg) return null; // Nummerierung aus
  // Format: Präfix {Trenner} Jahr {Trenner} Ziffer (aufgefüllt).
  const number = buildInventoryNumber(cfg, cfg.assigned);
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
  // Mengen: aktuell verliehene bzw. noch verfügbare Menge (quantity − verliehen).
  lentQuantity: number;
  availableQuantity: number;
  openDefects: number;
  // automatischer Status: nicht entleihbar / verfügbar / entliehen
  availability: InventoryAvailability;
};

function availabilityOf(
  lendable: boolean,
  quantity: number,
  lentQuantity: number,
): InventoryAvailability {
  if (!lendable) return "not_lendable";
  // Erst „entliehen", wenn KEINE Einheit mehr frei ist (Mengen: quantity − verliehen).
  return lentQuantity >= quantity ? "lent" : "available";
}

/**
 * Frei verfügbare Menge eines Stücks — identisch zu `getFreeQuantities`, nur
 * aus bereits geladenen Daten. Nicht entleihbare sowie defekte/verlorene Stücke
 * sind IMMER 0, damit Summen über Obergruppen sie nicht als verfügbar zählen.
 */
function freeQuantityOf(
  lendable: boolean,
  condition: string,
  quantity: number,
  lentQuantity: number,
): number {
  if (!lendable || condition !== "active") return 0;
  return Math.max(0, quantity - lentQuantity);
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
    const lentQuantity = loan?.lentQuantity ?? 0;
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
      lentQuantity,
      availableQuantity: freeQuantityOf(
        it.lendable,
        it.condition,
        it.quantity,
        lentQuantity,
      ),
      openDefects: defectCounts.get(it.id) ?? 0,
      availability: availabilityOf(it.lendable, it.quantity, lentQuantity),
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
  const lentQuantity = loan?.lentQuantity ?? 0;
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
    lentQuantity,
    availableQuantity: freeQuantityOf(
      item.lendable,
      item.condition,
      item.quantity,
      lentQuantity,
    ),
    openDefects: defectMap.get(id) ?? 0,
    availability: availabilityOf(item.lendable, item.quantity, lentQuantity),
  };
}

export type ItemInput = {
  name: string;
  groupName: string | null;
  quantity: number;
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
        groupName: data.groupName,
        quantity: data.quantity,
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

/**
 * Gegenstand löschen. Räumt dabei die Leih-Verknüpfungen sauber ab:
 *  - Vorgänge, für die das Stück das Leit-Stück ist, werden per FK-Cascade
 *    mitgelöscht → deren Tracking-Karten werden hier entfernt (sonst verwaist).
 *  - Vorgänge, in denen das Stück nur EINES von mehreren ist, bleiben bestehen;
 *    ihr Karten-Titel (×N) wird nach dem Entfernen aktualisiert.
 */
export async function deleteInventoryItem(id: number): Promise<void> {
  // Dateipfade VOR dem Löschen sichern: Der FK-Cascade entfernt zwar die Zeilen
  // in inventory_attachments, nicht aber die Dateien im Upload-Verzeichnis.
  // Ohne diesen Schritt blieben Kaufbelege, Leihverträge und vor allem
  // Studierendenausweise dauerhaft auf der Platte liegen, obwohl der Gegenstand
  // gelöscht wurde (Aufbewahrungs-/Datenschutzproblem).
  const filePaths = (
    await db
      .select({ path: inventoryAttachments.path })
      .from(inventoryAttachments)
      .where(eq(inventoryAttachments.itemId, id))
  ).map((r) => r.path);

  // Vorgänge, die dieses Stück als Leit-Stück haben — sie verschwinden per
  // FK-Cascade mit dem Gegenstand (`inventory_loans.item_id` ON DELETE CASCADE).
  const leadLoans = await db
    .select({ id: inventoryLoans.id, cardId: inventoryLoans.cardId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.itemId, id));
  // Karten dieser Vorgänge (sonst verwaist auf dem Leihboard).
  const leadCardIds = leadLoans
    .map((r) => r.cardId)
    .filter((c): c is number => c != null);
  const leadLoanIds = leadLoans.map((r) => r.id);

  // Vorgänge, in denen das Stück nur Mitglied (nicht Leit-Stück) ist.
  const survivingLoanIds = Array.from(
    new Set(
      (
        await db
          .select({ loanId: inventoryLoanItems.loanId })
          .from(inventoryLoanItems)
          .innerJoin(
            inventoryLoans,
            eq(inventoryLoans.id, inventoryLoanItems.loanId),
          )
          .where(
            and(
              eq(inventoryLoanItems.itemId, id),
              ne(inventoryLoans.itemId, id),
            ),
          )
      ).map((r) => r.loanId),
    ),
  );

  await db.transaction(async (tx) => {
    // Studierendenausweise der mit-cascadierten Vorgänge ZUERST löschen — exakt
    // wie in `deleteLoan`. Sie hängen am LEIT-Stück des Vorgangs, und das muss
    // nicht dieses hier sein: Wandert die Leit-Rolle über `removeLoanItem` auf
    // ein anderes Stück, bleibt der Ausweis am ursprünglichen Gegenstand liegen.
    // Verschwindet dann das neue Leit-Stück, nimmt der Cascade zwar den Vorgang
    // mit, den Ausweis aber nicht: `inventory_attachments.loan_id` ist
    // ON DELETE SET NULL — das Ausweisdokument bliebe unzugeordnet und dauerhaft
    // an einem fremden Gegenstand hängen (Aufbewahrungs-/Datenschutzproblem).
    if (leadLoanIds.length) {
      const ausweise = await tx
        .delete(inventoryAttachments)
        .where(
          and(
            inArray(inventoryAttachments.loanId, leadLoanIds),
            eq(inventoryAttachments.kind, "student_card"),
          ),
        )
        .returning({ path: inventoryAttachments.path });
      filePaths.push(...ausweise.map((a) => a.path));
    }
    await tx.delete(inventoryItems).where(eq(inventoryItems.id, id)); // Cascade
    if (leadCardIds.length) {
      // Anhänge der Tracking-Karten: `attachments.card_id` ist ON DELETE
      // CASCADE, die Dateien bleiben aber liegen. Die Karten sind normale
      // Kanban-Karten, an die jedes Board-Mitglied PDFs hängen kann.
      const kartenDateien = await tx
        .select({ path: attachments.path })
        .from(attachments)
        .where(inArray(attachments.cardId, leadCardIds));
      filePaths.push(...kartenDateien.map((a) => a.path));
      await tx.delete(cards).where(inArray(cards.id, leadCardIds));
    }
  });

  // Erst NACH dem Commit die Dateien entfernen: Rollt die Transaktion zurück,
  // bleiben Zeilen und Dateien zusammen erhalten. Fehlschläge hier sind
  // unkritisch (deleteStoredFile schluckt sie) — die Zeilen sind bereits weg.
  for (const p of filePaths) await deleteStoredFile(p);

  // Titel der überlebenden Vorgangs-Karten nachziehen (Stückzahl hat sich geändert).
  for (const loanId of survivingLoanIds) {
    await updateTrackingCardTitle(loanId);
  }
}

/**
 * Bestehende, nicht-leere Obergruppen-Namen eines Boards (alphabetisch).
 *
 * `publicOnly` beschränkt auf Obergruppen, die mindestens EIN öffentlich
 * sichtbares Stück haben (entleihbar + Zustand aktiv) — dieselbe Bedingung wie
 * in `lib/inventory-public.ts`. Ohne diese Beschränkung bestätigte die
 * öffentliche Anfrageseite auch rein interne Obergruppennamen: Wer den Namen
 * riet, bekam ein Formular statt einer 404 und konnte so die interne
 * Gruppenbenennung durchprobieren.
 */
export async function listInventoryGroupNames(
  boardId: number,
  opts: { publicOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupName: inventoryItems.groupName })
    .from(inventoryItems)
    .where(
      opts.publicOnly
        ? and(
            eq(inventoryItems.boardId, boardId),
            eq(inventoryItems.lendable, true),
            eq(inventoryItems.condition, "active"),
          )
        : eq(inventoryItems.boardId, boardId),
    );
  return rows
    .map((r) => (r.groupName ?? "").trim())
    .filter((g) => g !== "")
    .sort((a, b) => a.localeCompare(b, "de"));
}

/**
 * Verfügbare EINHEITEN einer Obergruppe — für die öffentliche Stückzahl-
 * Ausleihe. Maßgeblich ist die Stückzahl, nicht die Anzahl der Datensätze: ein
 * Gruppenmitglied mit `quantity > 1` steuert entsprechend mehrere Einheiten bei,
 * bereits verliehene Mengen werden abgezogen. Nicht entleihbare sowie defekte/
 * verlorene Stücke zählen nie mit.
 *
 * `units` verteilt bis zu `limit` Einheiten der Reihe nach (aufsteigend nach
 * Inventarnummer) auf die Mitglieder; `available` ist die insgesamt freie Menge
 * der Obergruppe (für Anzeige und Fehlermeldungen).
 */
export async function getAvailableGroupUnits(
  boardId: number,
  groupName: string,
  limit: number,
): Promise<{ units: LoanUnit[]; available: number }> {
  const rows = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.boardId, boardId),
        eq(inventoryItems.groupName, groupName),
        eq(inventoryItems.condition, "active"),
        eq(inventoryItems.lendable, true),
      ),
    )
    .orderBy(asc(inventoryItems.number), asc(inventoryItems.id));
  if (!rows.length) return { units: [], available: 0 };

  const free = await getFreeQuantities(rows.map((r) => r.id));
  const units: LoanUnit[] = [];
  let available = 0;
  let remaining = Math.max(0, Math.floor(limit));
  for (const r of rows) {
    const f = free.get(r.id) ?? 0;
    available += f;
    if (remaining > 0 && f > 0) {
      const take = Math.min(f, remaining);
      units.push({ itemId: r.id, quantity: take });
      remaining -= take;
    }
  }
  return { units, available };
}

/**
 * Verfügbare Menge eines EINZELNEN Mengen-Gegenstands (quantity − aktuell
 * verliehen). 0, wenn nicht entleihbar oder nicht im Zustand „aktiv".
 * Nutzt dieselbe Berechnung wie Obergruppen (`getFreeQuantities`), damit
 * Einzel-, Mengen- und Gruppen-Fall nicht auseinanderlaufen können.
 */
export async function getAvailableItemQuantity(itemId: number): Promise<number> {
  const free = await getFreeQuantities([itemId]);
  return free.get(itemId) ?? 0;
}
