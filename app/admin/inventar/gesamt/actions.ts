// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  setBoardInOverview,
  setOverviewMinPrice,
} from "@/lib/inventory-overview";

function parseEuroToCents(raw: FormDataEntryValue | null): number {
  if (typeof raw !== "string") return 0;
  const s = raw.trim();
  if (!s) return 0;
  const normalized = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
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
