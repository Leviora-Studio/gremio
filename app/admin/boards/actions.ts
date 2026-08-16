// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { BoardDeleteBlockedError, deleteBoardCascade } from "@/lib/boards";

export type State = { error?: string; success?: string };

export async function transferOwnerAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const newOwnerId = Number(formData.get("ownerId"));
  if (!Number.isInteger(newOwnerId)) return;
  const [owner] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, newOwnerId), eq(users.isActive, true)))
    .limit(1);
  if (!owner) return; // nur aktive Nutzer dürfen Eigentümer werden
  await db.update(boards).set({ ownerId: newOwnerId }).where(eq(boards.id, boardId));
  revalidatePath("/admin/boards");
}

export async function deleteBoardAdminAction(
  boardId: number,
  _prev: State,
  _formData: FormData,
): Promise<State> {
  await requireAdmin();
  try {
    await deleteBoardCascade(boardId);
  } catch (err) {
    if (err instanceof BoardDeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }
  revalidatePath("/admin/boards");
  return { success: "Board gelöscht." };
}

/** Wie deleteBoardAdminAction, aber ohne Form-Argumente (In-App-Bestätigung). */
export async function deleteBoardAdminConfirmedAction(
  boardId: number,
): Promise<State> {
  await requireAdmin();
  try {
    await deleteBoardCascade(boardId);
  } catch (err) {
    if (err instanceof BoardDeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }
  revalidatePath("/admin/boards");
  return { success: "Board gelöscht." };
}
