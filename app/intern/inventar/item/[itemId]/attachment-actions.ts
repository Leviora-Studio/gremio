// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AUSWEIS_MIME, PDF_MIME } from "@/lib/constants";
import { validateUpload } from "@/lib/attachments";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getLoanById } from "@/lib/inventory-loans";
import {
  addInventoryAttachment,
  deleteInventoryAttachment,
  getInventoryAttachmentById,
  INVENTORY_ATTACHMENT_KINDS,
  type InventoryAttachmentKind,
} from "@/lib/inventory-attachments";
import type { InventoryItem } from "@/lib/db/schema";

export type AttachmentState = { error?: string; ok?: boolean };

async function assertItemAccess(
  itemId: number,
): Promise<{ userId: number; item: InventoryItem }> {
  const user = await requireUser();
  const item = await getInventoryItemById(itemId);
  if (!item) throw new Error("Gegenstand nicht gefunden.");
  const board = await getInventoryBoardById(item.boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    throw new Error("Kein Zugriff.");
  }
  return { userId: user.id, item };
}

export async function uploadInventoryAttachmentAction(
  _prev: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const itemId = Number(formData.get("itemId"));
  const kind = String(formData.get("kind")) as InventoryAttachmentKind;
  if (!INVENTORY_ATTACHMENT_KINDS.includes(kind)) {
    return { error: "Ungültige Dateiart." };
  }

  let access;
  try {
    access = await assertItemAccess(itemId);
  } catch {
    return { error: "Kein Zugriff." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei ausgewählt." };
  // Kaufbelege dürfen auch Foto-Scans sein (PDF/PNG/JPG); Verträge/Anträge PDF.
  const allowed = kind === "receipt" ? AUSWEIS_MIME : PDF_MIME;
  const err = validateUpload(file, allowed);
  if (err) return { error: err };

  try {
    await addInventoryAttachment(itemId, kind, file, access.userId);
  } catch {
    return { error: "Upload fehlgeschlagen. Bitte erneut versuchen." };
  }
  revalidatePath(`/intern/inventar/item/${itemId}`);
  return { ok: true };
}

/**
 * Leihvertrag (oder Leihantrag) für einen konkreten Entleihvorgang bereitstellen.
 * Wird über die Statusseite vom Entleiher heruntergeladen + unterschrieben.
 */
export async function uploadLoanContractAction(
  _prev: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const loan = await getLoanById(Number(formData.get("loanId")));
  if (!loan) return { error: "Vorgang nicht gefunden." };
  const kind = String(formData.get("kind")) as InventoryAttachmentKind;
  if (kind !== "loan_contract" && kind !== "loan_request") {
    return { error: "Ungültige Dateiart." };
  }

  let access;
  try {
    access = await assertItemAccess(loan.itemId);
  } catch {
    return { error: "Kein Zugriff." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Keine Datei ausgewählt." };
  const err = validateUpload(file, PDF_MIME);
  if (err) return { error: err };

  try {
    await addInventoryAttachment(loan.itemId, kind, file, access.userId, loan.id);
  } catch {
    return { error: "Upload fehlgeschlagen. Bitte erneut versuchen." };
  }
  revalidatePath(`/intern/inventar/item/${loan.itemId}`);
  return { ok: true };
}

export async function deleteInventoryAttachmentAction(
  formData: FormData,
): Promise<void> {
  const att = await getInventoryAttachmentById(Number(formData.get("attId")));
  if (!att) return;
  const { item } = await assertItemAccess(att.itemId);
  await deleteInventoryAttachment(att.id);
  revalidatePath(`/intern/inventar/item/${item.id}`);
}
