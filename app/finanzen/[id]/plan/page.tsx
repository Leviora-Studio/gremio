// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { financePlanItems } from "@/lib/db/schema";
import { requireFinanceWrite } from "@/lib/finance";
import { FinancePlanConfirmation } from "@/components/finance/FinancePlanConfirmation";
import { FinancePlanEditor } from "@/components/finance/FinancePlanEditor";

export default async function FinancePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { fb } = await requireFinanceWrite(Number((await params).id));
  const items = await db.select().from(financePlanItems).where(eq(financePlanItems.financeBoardId, fb.id)).orderBy(asc(financePlanItems.position));
  return <div className="space-y-5">
    <Link href={`/finanzen/${fb.id}`} className="text-sm text-brand-600">← {fb.name}</Link>
    <h1 className="text-2xl font-bold">Haushaltsplan bearbeiten</h1>
    <FinancePlanConfirmation boardId={fb.id}><FinancePlanEditor fbId={fb.id} items={items} /></FinancePlanConfirmation>
  </div>;
}
