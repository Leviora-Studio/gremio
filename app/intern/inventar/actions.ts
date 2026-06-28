// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createInventoryBoard } from "@/lib/inventory";

export type State = { error?: string };

const boardSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(120),
  description: z.string().trim().max(500).optional(),
});

export async function createInventoryBoardAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const user = await requireUser();
  const parsed = boardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const id = await createInventoryBoard(
    user.id,
    parsed.data.name,
    parsed.data.description ?? null,
  );
  redirect(`/intern/inventar/${id}`);
}
