// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

/** Preserve old bookmarks; creation now lives exclusively in the Admin Panel. */
export default async function NewFinanceBoardPage() {
  await requireAdmin();
  redirect("/admin/finanzboards");
}
