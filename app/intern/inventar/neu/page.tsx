// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { CreateInventoryBoardForm } from "@/components/inventory/CreateInventoryBoardForm";

export const metadata = { title: "Neues Inventar — Gremio" };

export default async function NewInventoryBoardPage() {
  await requireUser();
  return (
    <div className="space-y-4">
      <Link href="/intern/inventar" className="text-sm text-brand-600">
        ← Inventar
      </Link>
      <h1 className="text-2xl font-bold">Neues Inventar erstellen</h1>
      <CreateInventoryBoardForm />
    </div>
  );
}
