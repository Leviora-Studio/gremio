// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { allowRequest } from "@/lib/rate-limit";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import { createLoanRequest } from "@/lib/inventory-loans";

// Eingaben werden bei einem Fehler zurückgegeben, damit das Formular sie behält.
export type RequestValues = {
  borrower: string;
  email: string;
  startDate: string;
  endDate: string;
  purpose: string;
};
export type RequestState = { error?: string; values?: RequestValues };

const isDate = (s: string) => s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s);

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
  };

  if (!(await allowRequest("inventory-request", 5, 60_000))) {
    return {
      error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut.",
      values,
    };
  }

  // Alle fehlenden/ungültigen Felder sammeln (Eingaben bleiben erhalten).
  const missing: string[] = [];
  if (!values.borrower) missing.push("Name");
  if (!values.email) missing.push("E-Mail");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))
    missing.push("gültige E-Mail-Adresse");
  if (!isDate(values.startDate) || !isDate(values.endDate))
    missing.push("gültiges Datum");
  if (missing.length) {
    return { error: `Bitte ergänze: ${missing.join(", ")}.`, values };
  }

  const itemId = Number(formData.get("itemId"));
  const item = await getInventoryItemById(itemId);
  if (!item) return { error: "Gegenstand nicht gefunden.", values };
  const board = await getPublicInventoryBoardById(item.boardId);
  if (!board)
    return { error: "Dieses Inventar ist nicht öffentlich.", values };

  const { token } = await createLoanRequest(item.id, {
    borrower: values.borrower,
    borrowerEmail: values.email,
    purpose: values.purpose || null,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
    notes: null,
  });

  redirect(`/inventar/status/${token}`);
}
