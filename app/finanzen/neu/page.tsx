// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeTemplates } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { CreateFinanceBoardForm } from "@/components/finance/CreateFinanceBoardForm";

export const metadata = { title: "Neue Finanzübersicht — Gremio" };

export default async function NewFinanceBoardPage() {
  await requireUser();
  const templates = await db
    .select({ id: financeTemplates.id, name: financeTemplates.name })
    .from(financeTemplates)
    .orderBy(asc(financeTemplates.name));

  return (
    <div className="space-y-4">
      <Link href="/finanzen" className="text-sm text-brand-600">
        ← Alle Finanzübersichten
      </Link>
      <h1 className="text-2xl font-bold">Neue Finanzübersicht erstellen</h1>
      <CreateFinanceBoardForm templates={templates} />
    </div>
  );
}
