// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { getAccessibleBoards } from "@/lib/authz";
import { authApi, serializeBoard, tokenAllowsBoard } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const boards = (await getAccessibleBoards(ctx.user)).filter((b) =>
    tokenAllowsBoard(ctx, b.id),
  );
  return NextResponse.json({
    boards: boards.map((b) => serializeBoard(b, ctx.user)),
  });
}
