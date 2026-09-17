// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { commentsApi } from "@/lib/api-card-extras";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const p = await params;
  return commentsApi(req, p.id, p.commentId);
}
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const p = await params;
  return commentsApi(req, p.id, p.commentId);
}
