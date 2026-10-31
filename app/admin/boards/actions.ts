// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { BoardDeleteBlockedError, deleteBoardCascade } from "@/lib/boards";

export type State = { error?: string; success?: string };


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
