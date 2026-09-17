// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activityApi } from "@/lib/api-card-extras";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return activityApi(req, p.id);
}
