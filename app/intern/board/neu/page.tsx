// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardTemplates } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { CreateBoardForm } from "@/components/CreateBoardForm";

export const metadata = { title: "Neues Board — Gremio" };

export default async function NewBoardPage() {
  await requireUser();
  const templates = await db
    .select({ id: boardTemplates.id, name: boardTemplates.name })
    .from(boardTemplates)
    .orderBy(asc(boardTemplates.name));

  return (
    <div className="space-y-4">
      <Link href="/intern" className="text-sm text-brand-600">
        ← Alle Boards
      </Link>
      <h1 className="text-2xl font-bold">Neues Board erstellen</h1>
      <CreateBoardForm templates={templates} />
    </div>
  );
}
