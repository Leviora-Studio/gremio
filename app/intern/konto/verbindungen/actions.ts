// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";
import { McpGrantError } from "@/lib/mcp-oauth";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { editMcpGrant, revokeMcpGrant } from "@/lib/mcp-oauth";
export async function saveConnection(
  id: string,
  _state: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const user = await requireUser();
  try {
    if (form.get("decision") === "revoke") await revokeMcpGrant(user.id, id);
    else
      await editMcpGrant(user, id, {
        scope: form.get("scope"),
        allBoards: form.get("allBoards") === "on",
        boardIds:
          form.get("allBoards") === "on"
            ? []
            : form.getAll("boardId").map(Number),
      });
  } catch (e) {
    return {
      error:
        e instanceof McpGrantError ? e.message : "Änderung fehlgeschlagen.",
    };
  }
  revalidatePath("/intern/konto/verbindungen");
  return { success: "Freigabe aktualisiert." };
}
