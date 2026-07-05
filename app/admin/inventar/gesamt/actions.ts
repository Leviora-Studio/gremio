// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  setBoardInOverview,
  setOverviewMinPrice,
} from "@/lib/inventory-overview";
import { parseEuroToCents as parseEuro } from "@/lib/money";

/** Mindestpreis-Eingabe → Cent (0 = kein Minimum). */
function parseEuroToCents(raw: FormDataEntryValue | null): number {
  return typeof raw === "string" ? (parseEuro(raw) ?? 0) : 0;
}

export async function setOverviewMinPriceAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  await setOverviewMinPrice(parseEuroToCents(formData.get("minPrice")));
  revalidatePath("/admin/inventar/gesamt");
}

export async function toggleBoardOverviewAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const boardId = Number(formData.get("boardId"));
  if (!Number.isInteger(boardId)) return;
  await setBoardInOverview(boardId, formData.get("include") === "1");
  revalidatePath("/admin/inventar/gesamt");
}
