// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { allowRequest } from "@/lib/rate-limit";
import {
  getAvailableGroupItemIds,
  getInventoryItemById,
} from "@/lib/inventory-items";
import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import { createLoanRequest } from "@/lib/inventory-loans";

// Eingaben werden bei einem Fehler zurückgegeben, damit das Formular sie behält.
export type RequestValues = {
  borrower: string;
  email: string;
  startDate: string;
  endDate: string;
  purpose: string;
  quantity: string;
};
export type RequestState = { error?: string; values?: RequestValues };

// Datum + Uhrzeit (datetime-local) — Pflicht.
const isDateTime = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);

/** Öffentliche Entleih-Anfrage zu einem Gegenstand. Leitet zur Statusseite weiter. */
export async function createInventoryLoanRequestAction(
  _prev: RequestState,
  formData: FormData,
): Promise<RequestState> {
  const values: RequestValues = {
    borrower: String(formData.get("borrower") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    purpose: String(formData.get("purpose") ?? "").trim(),
    quantity: String(formData.get("quantity") ?? "1"),
  };

  if (!(await allowRequest("inventory-request", 5, 60_000))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
      values,
    };
  }

  // Alle Felder sind Pflicht — fehlende/ungültige sammeln (Eingaben bleiben).
  const missing: string[] = [];
  if (!values.borrower) missing.push("Name");
  if (!values.email) missing.push("E-Mail");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))
    missing.push("gültige E-Mail-Adresse");
  if (!values.purpose) missing.push("Verwendungsort / Zweck");
  if (!isDateTime(values.startDate)) missing.push("Von (Datum + Uhrzeit)");
  if (!isDateTime(values.endDate)) missing.push("Bis (Datum + Uhrzeit)");
  if (missing.length) {
    return { error: `Bitte ergänze: ${missing.join(", ")}.`, values };
  }

  // Zwei Varianten: einzelner Gegenstand (itemId) oder Stückzahl aus einer
  // Artikel/Gruppe (boardId + groupName + quantity → konkrete Stücke).
  const groupName = String(formData.get("groupName") ?? "").trim();
  let itemIds: number[];

  if (groupName) {
    const boardId = Number(formData.get("boardId"));
    const board = await getPublicInventoryBoardById(boardId);
    if (!board)
      return { error: "Dieses Inventar ist nicht öffentlich.", values };
    const quantity = Math.floor(Number(values.quantity));
    if (!Number.isFinite(quantity) || quantity < 1)
      return { error: "Bitte eine gültige Stückzahl wählen.", values };
    itemIds = await getAvailableGroupItemIds(board.id, groupName, quantity);
    if (itemIds.length < quantity) {
      return {
        error:
          itemIds.length === 0
            ? "Von diesem Artikel ist aktuell nichts verfügbar."
            : `Aktuell sind nur ${itemIds.length} Stück verfügbar.`,
        values,
      };
    }
  } else {
    const itemId = Number(formData.get("itemId"));
    const item = await getInventoryItemById(itemId);
    if (!item) return { error: "Gegenstand nicht gefunden.", values };
    const board = await getPublicInventoryBoardById(item.boardId);
    if (!board)
      return { error: "Dieses Inventar ist nicht öffentlich.", values };
    if (!item.lendable || item.condition !== "active")
      return { error: "Dieser Gegenstand ist nicht verfügbar.", values };
    itemIds = [item.id];
  }

  const { token } = await createLoanRequest(itemIds, {
    borrower: values.borrower,
    borrowerEmail: values.email,
    purpose: values.purpose || null,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    notes: null,
  });

  redirect(`/inventar/status/${token}`);
}
