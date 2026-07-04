// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getVisibleInventoryFieldKeys } from "@/lib/inventory-fields";
import {
  addInventoryOption,
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItemById,
  OPTION_KINDS,
  updateInventoryItem,
  type ItemInput,
  type ItemPatch,
  type OptionKind,
} from "@/lib/inventory-items";
import { addInventoryAttachment } from "@/lib/inventory-attachments";
import { AUSWEIS_MIME } from "@/lib/constants";
import { validateUpload } from "@/lib/attachments";

export type ItemActionState = { error?: string; ok?: boolean };

/** Euro-String („12,50" / „12.5" / „1.234,56") → Cent, oder null. */
function parseEuroToCents(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function parseDate(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseOptionId(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseText(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s ? s.slice(0, 2000) : null;
}

function parseCategoryIds(formData: FormData): number[] {
  return formData
    .getAll("categoryIds")
    .map((v) => (typeof v === "string" ? Number.parseInt(v, 10) : NaN))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Aus dem Formular nur die am Board sichtbaren Felder übernehmen. */
function readFields(formData: FormData, visible: Set<string>) {
  const out: ItemPatch = {};
  if (visible.has("group"))
    out.groupName = parseText(formData.get("groupName"));
  if (visible.has("number")) out.number = parseText(formData.get("number"));
  if (visible.has("serial_number"))
    out.serialNumber = parseText(formData.get("serialNumber"));
  if (visible.has("condition")) {
    const cond = String(formData.get("condition") ?? "active");
    out.condition = ["active", "defect", "lost"].includes(cond)
      ? cond
      : "active";
    out.conditionNote = parseText(formData.get("conditionNote"));
  }
  if (visible.has("lendable")) out.lendable = formData.get("lendable") === "1";
  if (visible.has("location"))
    out.locationId = parseOptionId(formData.get("locationId"));
  if (visible.has("price")) out.price = parseEuroToCents(formData.get("price"));
  if (visible.has("purchase_date"))
    out.purchaseDate = parseDate(formData.get("purchaseDate"));
  if (visible.has("vendor")) out.vendor = parseText(formData.get("vendor"));
  if (visible.has("notes")) out.notes = parseText(formData.get("notes"));
  if (visible.has("category")) out.categoryIds = parseCategoryIds(formData);
  return out;
}

async function requireAccess(boardId: number) {
  const user = await requireUser();
  const board = await getInventoryBoardById(boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    throw new Error("Kein Zugriff.");
  }
  return { user, board };
}

export async function createInventoryItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const boardId = Number(formData.get("boardId"));
  let user;
  try {
    ({ user } = await requireAccess(boardId));
  } catch {
    return { error: "Kein Zugriff." };
  }

  const name = parseText(formData.get("name"));
  if (!name) return { error: "Bezeichnung erforderlich." };

  const visible = await getVisibleInventoryFieldKeys(boardId);
  const fields = readFields(formData, visible);
  const data: ItemInput = {
    name,
    groupName: fields.groupName ?? null,
    number: fields.number ?? null,
    serialNumber: fields.serialNumber ?? null,
    condition: fields.condition ?? "active",
    conditionNote: fields.conditionNote ?? null,
    lendable: fields.lendable ?? true,
    locationId: fields.locationId ?? null,
    price: fields.price ?? null,
    purchaseDate: fields.purchaseDate ?? null,
    vendor: fields.vendor ?? null,
    notes: fields.notes ?? null,
    categoryIds: fields.categoryIds ?? [],
  };
  const itemId = await createInventoryItem(boardId, user.id, data);

  // Kaufbelege, die direkt beim Anlegen hochgeladen wurden (optional, max. 10).
  const receipts = formData
    .getAll("receiptFiles")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, 10);
  for (const file of receipts) {
    if (validateUpload(file, AUSWEIS_MIME)) continue; // ungültige überspringen
    try {
      await addInventoryAttachment(itemId, "receipt", file, user.id);
    } catch {
      /* einzelnen fehlgeschlagenen Beleg ignorieren */
    }
  }

  revalidatePath(`/intern/inventar/${boardId}`);
  return { ok: true };
}

export async function updateInventoryItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const itemId = Number(formData.get("itemId"));
  const item = await getInventoryItemById(itemId);
  if (!item) return { error: "Gegenstand nicht gefunden." };
  try {
    await requireAccess(item.boardId);
  } catch {
    return { error: "Kein Zugriff." };
  }

  const name = parseText(formData.get("name"));
  if (!name) return { error: "Bezeichnung erforderlich." };

  const visible = await getVisibleInventoryFieldKeys(item.boardId);
  const patch = readFields(formData, visible);
  patch.name = name;
  await updateInventoryItem(itemId, patch);
  revalidatePath(`/intern/inventar/${item.boardId}`);
  return { ok: true };
}

export async function deleteInventoryItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const itemId = Number(formData.get("itemId"));
  const item = await getInventoryItemById(itemId);
  if (!item) return { error: "Gegenstand nicht gefunden." };
  try {
    await requireAccess(item.boardId);
  } catch {
    return { error: "Kein Zugriff." };
  }
  await deleteInventoryItem(itemId);
  revalidatePath(`/intern/inventar/${item.boardId}`);
  return { ok: true };
}

const optionSchema = z.object({
  boardId: z.coerce.number().int().positive(),
  kind: z.enum(OPTION_KINDS),
  name: z.string().trim().min(1, "Name erforderlich.").max(80),
});

/**
 * Neue Option (Kategorie/Standort/Entleihstatus) direkt beim Erfassen anlegen.
 * Gibt die Option zurück, damit der Client sie sofort auswählen kann.
 */
export async function addInventoryOptionAction(input: {
  boardId: number;
  kind: OptionKind;
  name: string;
}): Promise<{ id: number; name: string; kind: OptionKind } | { error: string }> {
  const parsed = optionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  try {
    await requireAccess(parsed.data.boardId);
  } catch {
    return { error: "Kein Zugriff." };
  }
  const opt = await addInventoryOption(
    parsed.data.boardId,
    parsed.data.kind,
    parsed.data.name,
  );
  revalidatePath(`/intern/inventar/${parsed.data.boardId}`);
  return { id: opt.id, name: opt.name, kind: opt.kind as OptionKind };
}
