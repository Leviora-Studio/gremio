// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, getBoardById, getBoardMemberUsers } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ users: [] }, { status: 401 });

  const { id } = await params;
  const board = await getBoardById(Number(id));
  if (!board || !(await canAccessBoard(user, board))) {
    return NextResponse.json({ users: [] }, { status: 403 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .toLowerCase();
  let members = await getBoardMemberUsers(board);
  if (q) {
    members = members.filter(
      (m) =>
        m.username.toLowerCase().includes(q) ||
        (m.name ?? "").toLowerCase().includes(q),
    );
  }
  return NextResponse.json({ users: members.slice(0, 10) });
}
