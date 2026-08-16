// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryAttachments,
  type InventoryAttachment,
} from "@/lib/db/schema";
import { deleteStoredFile, saveNamedFile } from "@/lib/attachments";
import {
  INVENTORY_ATTACHMENT_KINDS,
  INVENTORY_ATTACHMENT_LABELS,
  type InventoryAttachmentKind,
} from "@/lib/inventory-attachment-kinds";

// Für bestehende Server-Importe aus diesem Modul weiterreichen.
export {
  INVENTORY_ATTACHMENT_KINDS,
  INVENTORY_ATTACHMENT_LABELS,
  type InventoryAttachmentKind,
};

/** Alle Dateien eines Gegenstands, nach Art gruppiert (neueste zuerst). */
export async function listInventoryAttachments(
  itemId: number,
): Promise<Record<InventoryAttachmentKind, InventoryAttachment[]>> {
  const rows = await db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.itemId, itemId))
    .orderBy(desc(inventoryAttachments.uploadedAt));
  const grouped: Record<InventoryAttachmentKind, InventoryAttachment[]> = {
    receipt: [],
    loan_request: [],
    loan_contract: [],
    student_card: [],
    other: [],
  };
  for (const r of rows) {
    const k = r.kind as InventoryAttachmentKind;
    if (grouped[k]) grouped[k].push(r);
  }
  return grouped;
}

/** Dateien, die an einen konkreten Entleihvorgang/Anfrage gebunden sind. */
export async function listLoanAttachments(
  loanId: number,
): Promise<InventoryAttachment[]> {
  if (!Number.isInteger(loanId)) return [];
  return db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.loanId, loanId))
    .orderBy(desc(inventoryAttachments.uploadedAt));
}

export async function getInventoryAttachmentById(
  id: number,
): Promise<InventoryAttachment | undefined> {
  if (!Number.isInteger(id)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.id, id))
    .limit(1);
  return row;
}

/** Datei speichern + Anhang-Zeile anlegen. Gibt die Anhang-ID zurück. */
export async function addInventoryAttachment(
  itemId: number,
  kind: InventoryAttachmentKind,
  file: File,
  uploadedBy: number | null,
  loanId: number | null = null,
): Promise<number> {
  const saved = await saveNamedFile(join("inventory", String(itemId)), file);
  try {
    const [row] = await db
      .insert(inventoryAttachments)
      .values({
        itemId,
        loanId,
        kind,
        filename: saved.filename,
        path: saved.relPath,
        mime: saved.mime,
        size: saved.size,
        uploadedBy,
      })
      .returning({ id: inventoryAttachments.id });
    return row.id;
  } catch (e) {
    // DB-Insert gescheitert → frisch geschriebene Datei wieder entfernen.
    await deleteStoredFile(saved.relPath);
    throw e;
  }
}

export async function deleteInventoryAttachment(id: number): Promise<void> {
  const [row] = await db
    .select({ path: inventoryAttachments.path })
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.id, id))
    .limit(1);
  if (!row) return;
  await db.delete(inventoryAttachments).where(eq(inventoryAttachments.id, id));
  await deleteStoredFile(row.path);
}

/** Anhänge eines Gegenstands einer bestimmten Art (für die öffentliche/interne Anzeige). */
export async function countInventoryAttachments(
  itemId: number,
  kind: InventoryAttachmentKind,
): Promise<number> {
  const rows = await db
    .select({ id: inventoryAttachments.id })
    .from(inventoryAttachments)
    .where(
      and(
        eq(inventoryAttachments.itemId, itemId),
        eq(inventoryAttachments.kind, kind),
      ),
    );
  return rows.length;
}
