// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";

import { revalidatePath } from "next/cache";
import { requireBoardManage } from "@/lib/authz";
import { BoardManagementError, setBoardManager } from "@/lib/board-management";

export async function setBoardManagerAction(boardId: number, _previous: { error?: string; success?: string }, form: FormData): Promise<{ error?: string; success?: string }> {
  const { user } = await requireBoardManage(boardId);
  try {
    const enabled = form.get("operation") === "add";
    if (!enabled && form.get("operation") !== "remove") return { error: "Ungültige Änderung." };
    await setBoardManager(user, boardId, Number(form.get("userId")), enabled);
    revalidatePath(`/intern/board/${boardId}`, "layout");
    return { success: enabled ? "Verwaltungsrechte vergeben." : "Verwaltungsrechte entzogen." };
  } catch (error) {
    if (error instanceof BoardManagementError) return { error: error.message };
    throw error;
  }
}
