// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { CardFrozenError } from "@/lib/card-freeze";
import { BudgetPlanError } from "@/lib/card-budget-plan";
import { writeBudgetPlan } from "@/lib/card-budget-plan-db";

export async function saveBudgetPlanAction(cardId: number, revision: number, input: unknown) {
  const user = await requireUser();
  try {
    const nextRevision = await writeBudgetPlan(user, cardId, revision, input);
    revalidatePath(`/intern/card/${cardId}`);
    revalidatePath("/intern/sitzungen", "layout");
    return { revision: nextRevision };
  } catch (error) {
    return { error: (error instanceof BudgetPlanError || error instanceof CardFrozenError) ? error.message : "Einplanung konnte nicht gespeichert werden." };
  }
}
