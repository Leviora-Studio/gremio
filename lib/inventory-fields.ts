// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryBoardFields } from "@/lib/db/schema";

/**
 * Konfigurierbare Felder eines Gegenstands (wie board_card_fields bei Karten).
 * Die Bezeichnung (`name`) ist IMMER sichtbar und nicht abschaltbar — sie ist
 * die Identität des Gegenstands; deshalb steht sie hier nicht. Entleih-/Mängel-
 * Historie, „aktuell bei" und Belege folgen in einer späteren Phase (eigene
 * Feld-Schlüssel werden dann ergänzt).
 */
export const INVENTORY_FIELD_KEYS = [
  "number", // Inventarnummer
  "category", // Kategorie (Multiselect)
  "location", // Standort
  "loan_status", // Entleihstatus
  "price", // Kaufpreis
  "purchase_date", // Kaufdatum
  "vendor", // Händler
  "notes", // Notizen
] as const;

export type InventoryFieldKey = (typeof INVENTORY_FIELD_KEYS)[number];

export const INVENTORY_FIELD_LABELS: Record<InventoryFieldKey, string> = {
  number: "Inventarnummer",
  category: "Kategorie",
  location: "Standort",
  loan_status: "Entleihstatus",
  price: "Kaufpreis (€)",
  purchase_date: "Kaufdatum",
  vendor: "Händler",
  notes: "Notizen",
};

/**
 * Am Board AKTIVIERTE (sichtbare) Feld-Schlüssel — maßgeblich dafür, welche
 * Felder in Tabelle/Formular erscheinen und gespeichert werden dürfen.
 */
export async function getVisibleInventoryFieldKeys(
  boardId: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ fieldKey: inventoryBoardFields.fieldKey })
    .from(inventoryBoardFields)
    .where(
      and(
        eq(inventoryBoardFields.boardId, boardId),
        eq(inventoryBoardFields.visible, true),
      ),
    );
  return new Set(rows.map((r) => r.fieldKey));
}

/** Alle Feld-Einträge eines Boards (für die Einstellungen), sortiert. */
export async function getInventoryBoardFields(boardId: number) {
  return db
    .select()
    .from(inventoryBoardFields)
    .where(eq(inventoryBoardFields.boardId, boardId))
    .orderBy(asc(inventoryBoardFields.position));
}
