// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";

import { revalidatePath } from "next/cache";
import { requireInventoryBoardManage } from "@/lib/inventory";
import { BoardManagementError, setInventoryManager } from "@/lib/board-management";

export async function setInventoryManagerAction(boardId: number, _previous: { error?: string; success?: string }, form: FormData): Promise<{ error?: string; success?: string }> {
  const { user, board } = await requireInventoryBoardManage(boardId);
  try {
    const enabled = form.get("operation") === "add";
    if (!enabled && form.get("operation") !== "remove") return { error: "Ungültige Änderung." };
    await setInventoryManager(user, boardId, Number(form.get("userId")), enabled);
    revalidatePath(`/intern/inventar/${boardId}`, "layout");
    if (board.loanBoardId != null) revalidatePath(`/intern/board/${board.loanBoardId}`);
    return { success: enabled ? "Verwaltungsrechte vergeben." : "Verwaltungsrechte entzogen." };
  } catch (error) {
    if (error instanceof BoardManagementError) return { error: error.message };
    throw error;
  }
}
