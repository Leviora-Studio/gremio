// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { requireUser } from "@/lib/auth";
import { requireArea } from "@/lib/meetings/access";
import { BoardManagementError, setMeetingAreaManager } from "@/lib/board-management";
import { revalidatePath } from "next/cache";

export async function setMeetingAreaManagerAction(areaId: number, _previous: { error?: string; success?: string }, form: FormData): Promise<{ error?: string; success?: string }> {
  const user = await requireUser();
  await requireArea(user, areaId, "manage");
  const operation = form.get("operation");
  if (operation !== "add" && operation !== "remove") return { error: "Ungültige Änderung." };
  try {
    await setMeetingAreaManager(user, areaId, Number(form.get("userId")), operation === "add");
    revalidatePath("/intern/sitzungen", "layout");
    return { success: operation === "add" ? "Verwaltungsrechte vergeben." : "Verwaltungsrechte entzogen." };
  } catch (error) {
    if (error instanceof BoardManagementError) return { error: error.message };
    throw error;
  }
}
