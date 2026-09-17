// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { downloadMcpAttachment } from "@/lib/mcp-downloads";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cardId: string; attachmentId: string }> },
) {
  const { cardId, attachmentId } = await params;
  return downloadMcpAttachment(req, cardId, attachmentId);
}
