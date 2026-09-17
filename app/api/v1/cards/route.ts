// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { authApi } from "@/lib/api";
import { queryApiCards } from "@/lib/api-query";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  return queryApiCards(req, ctx, { paginated: true });
}
