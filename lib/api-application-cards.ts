// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { cardBudgetPlans } from "@/lib/db/schema";
import { resolveApiCard } from "@/lib/api-access";
import { apiError, readApiJson } from "@/lib/api";
import { lockApplicationCard } from "@/lib/card-lock";
import { CardFrozenError } from "@/lib/card-freeze";
import { writeBudgetPlan } from "@/lib/card-budget-plan-db";
import { BudgetPlanError } from "@/lib/card-budget-plan";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

export const lockCardSchema = z.object({ confirm: z.literal(true), expectedStatusId: z.number().int().positive().max(2147483647) }).strict();
export const budgetPlanWriteSchema = z.object({
  revision: z.number().int().min(0).max(2147483646),
  allocations: z.array(z.object({ accountId: z.number().int().positive().max(2147483647).nullable().optional(), amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS), budgetTitle: z.string().min(1).max(200) }).strict()).max(100),
  confirmAccountChange: z.literal(true).optional(),
  correction: z.object({reason:z.string().trim().min(1).max(4000),confirmation:z.literal("BESTÄTIGEN")}).strict().optional(),
}).strict();

export async function lockCardApi(req: Request, id: string) {
  const r = await resolveApiCard(req, id, true);
  if (r instanceof NextResponse) return r;
  const body = await readApiJson(req);
  if (!body.ok) return body.response;
  const parsed = lockCardSchema.safeParse(body.body);
  if (!parsed.success) return apiError(400, "Die dauerhafte Sperre muss ausdrücklich bestätigt werden; expectedStatusId ist erforderlich.");
  try {
    await lockApplicationCard(r.ctx.user, r.card.id, parsed.data.expectedStatusId);
    return NextResponse.json({ ok: true });
  } catch {
    return apiError(409, "Sperren nicht möglich. Aktives Antragsboard, Schreibzugriff und aktuelle Sperrspalte prüfen.");
  }
}

export async function budgetPlanApi(req: Request, id: string) {
  const r = await resolveApiCard(req, id, req.method !== "GET");
  if (r instanceof NextResponse) return r;
  if (!r.board.isApplicationBoard || r.board.inventoryBoardId != null) return apiError(409, "Kein aktives Antragsboard.");
  if (req.method === "PATCH") {
    const body = await readApiJson(req);
    if (!body.ok) return body.response;
    const parsed = budgetPlanWriteSchema.safeParse(body.body);
    if (!parsed.success) return apiError(400, "Ungültige Einplanung; revision und vollständige allocations erforderlich.");
    try {
      await writeBudgetPlan(r.ctx.user, r.card.id, parsed.data.revision, parsed.data.allocations.map(row => ({ amount: (row.amountCents / 100).toFixed(2), budgetTitle: row.budgetTitle, ...(row.accountId!==undefined?{accountId:row.accountId}:{}) })), {confirmAccountChange:parsed.data.confirmAccountChange,correction:parsed.data.correction});
    } catch (error) {
      if (error instanceof CardFrozenError || error instanceof BudgetPlanError) return apiError(409, error.message);
      throw error;
    }
  }
  const [plan] = await db.select().from(cardBudgetPlans).where(trashAnd(activeRows.cardBudgetPlans, eq(cardBudgetPlans.cardId, r.card.id)));
  return NextResponse.json({ revision: plan?.revision ?? 0, allocations: (plan?.allocations ?? []).map(row => ({ amountCents: row.amount, budgetTitle: row.budgetTitle, accountId:row.accountId??null })) });
}
