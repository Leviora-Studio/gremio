// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getCurrentUser } from "@/lib/auth";
import { protocolPdfResponse } from "@/lib/protocol-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser();
  const { id, sessionId } = await params;
  return protocolPdfResponse(user, Number(id), Number(sessionId), { filename: new URL(request.url).searchParams.get("name") ?? "", subfolder: new URL(request.url).searchParams.get("folder") ?? "" });
}
