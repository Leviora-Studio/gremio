// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { moveToTrash } from "@/lib/trash";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";


export type State = { error?: string; success?: string };


export async function deleteBoardAdminAction(boardId: number, _prev: State, formData: FormData): Promise<State> {
  return deleteBoardAdminConfirmedAction(boardId, formData.get("confirmation"), formData.get("boardName"));
}

/** Wie deleteBoardAdminAction, aber ohne Form-Argumente (In-App-Bestätigung). */
export async function deleteBoardAdminConfirmedAction(
  boardId: number,
  confirmation?: unknown,
  boardName?: unknown,
): Promise<State> {
  const user = await requireAdmin();
  try { await moveToTrash(user, "board", boardId, confirmation, { boardName }); }
  catch(error) { return {error:error instanceof Error ? error.message : "Verschieben in den Papierkorb fehlgeschlagen."}; }
  revalidatePath("/admin/boards"); revalidatePath("/admin/antragsboards"); revalidatePath("/intern", "layout");
  return {success:"Board für 30 Tage in den Papierkorb verschoben."};
}
