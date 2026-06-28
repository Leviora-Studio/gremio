// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { allowRequest } from "@/lib/rate-limit";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import { createLoanRequest } from "@/lib/inventory-loans";

export type RequestState = { error?: string };

const dateOrEmpty = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""));

const schema = z.object({
  itemId: z.coerce.number().int().positive(),
  borrower: z.string().trim().min(1, "Name erforderlich.").max(200),
  email: z.string().trim().email("Gültige E-Mail erforderlich.").max(200),
  purpose: z.string().trim().max(500).optional(),
  startDate: dateOrEmpty,
  endDate: dateOrEmpty,
});

/** Öffentliche Entleih-Anfrage zu einem Gegenstand. Leitet zur Statusseite weiter. */
export async function createInventoryLoanRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  if (!(await allowRequest("inventory-request", 5, 60_000))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
    };
  }

  const parsed = schema.safeParse({
    itemId: formData.get("itemId"),
    borrower: formData.get("borrower"),
    email: formData.get("email"),
    purpose: formData.get("purpose") || undefined,
    startDate: formData.get("startDate") || "",
    endDate: formData.get("endDate") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const item = await getInventoryItemById(parsed.data.itemId);
  if (!item) return { error: "Gegenstand nicht gefunden." };
  const board = await getPublicInventoryBoardById(item.boardId);
  if (!board) return { error: "Dieses Inventar ist nicht öffentlich." };

  const { token } = await createLoanRequest(item.id, {
    borrower: parsed.data.borrower,
    borrowerEmail: parsed.data.email,
    purpose: parsed.data.purpose ?? null,
    startDate: parsed.data.startDate || null,
    endDate: parsed.data.endDate || null,
    notes: null,
  });

  redirect(`/inventar/status/${token}`);
}
