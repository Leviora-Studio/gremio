// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import {
  createDefect,
  createLoan,
  deleteDefect,
  deleteLoan,
  getDefectById,
  getLoanById,
  returnLoan,
  setDefectResolved,
} from "@/lib/inventory-loans";
import type { InventoryItem } from "@/lib/db/schema";

async function assertItemAccess(itemId: number): Promise<{
  userId: number;
  item: InventoryItem;
}> {
  const user = await requireUser();
  const item = await getInventoryItemById(itemId);
  if (!item) throw new Error("Gegenstand nicht gefunden.");
  const board = await getInventoryBoardById(item.boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    throw new Error("Kein Zugriff.");
  }
  return { userId: user.id, item };
}

function revItem(item: InventoryItem) {
  revalidatePath(`/intern/inventar/item/${item.id}`);
  revalidatePath(`/intern/inventar/${item.boardId}`);
}

function text(fd: FormData, k: string, max = 500): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function date(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
    ? v.trim()
    : null;
}

// --- Entleihvorgänge ----------------------------------------------------

export async function createLoanAction(fd: FormData): Promise<void> {
  const itemId = Number(fd.get("itemId"));
  const { userId, item } = await assertItemAccess(itemId);
  const borrower = text(fd, "borrower", 200);
  if (!borrower) return;
  await createLoan(itemId, userId, {
    borrower,
    borrowerEmail: null,
    purpose: text(fd, "purpose"),
    startDate: date(fd, "startDate"),
    endDate: date(fd, "endDate"),
    notes: text(fd, "notes", 2000),
  });
  revItem(item);
}

export async function returnLoanAction(fd: FormData): Promise<void> {
  const loan = await getLoanById(Number(fd.get("loanId")));
  if (!loan) return;
  const { item } = await assertItemAccess(loan.itemId);
  await returnLoan(loan.id);
  revItem(item);
}

export async function deleteLoanAction(fd: FormData): Promise<void> {
  const loan = await getLoanById(Number(fd.get("loanId")));
  if (!loan) return;
  const { item } = await assertItemAccess(loan.itemId);
  await deleteLoan(loan.id);
  revItem(item);
}

// --- Mängel -------------------------------------------------------------

export async function createDefectAction(fd: FormData): Promise<void> {
  const itemId = Number(fd.get("itemId"));
  const { userId, item } = await assertItemAccess(itemId);
  const description = text(fd, "description", 1000);
  if (!description) return;
  await createDefect(itemId, userId, description);
  revItem(item);
}

export async function toggleDefectAction(fd: FormData): Promise<void> {
  const defect = await getDefectById(Number(fd.get("defectId")));
  if (!defect) return;
  const { item } = await assertItemAccess(defect.itemId);
  await setDefectResolved(defect.id, !defect.resolvedAt);
  revItem(item);
}

export async function deleteDefectAction(fd: FormData): Promise<void> {
  const defect = await getDefectById(Number(fd.get("defectId")));
  if (!defect) return;
  const { item } = await assertItemAccess(defect.itemId);
  await deleteDefect(defect.id);
  revItem(item);
}
