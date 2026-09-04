// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getCurrentUser } from "@/lib/auth";
import { protocolPdfResponse } from "@/lib/protocol-pdf";
import { readPdfFields } from "@/lib/pdf-edit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser();
  const { id, sessionId } = await params;
  const response = await protocolPdfResponse(user, Number(id), Number(sessionId), new URL(request.url).searchParams.get("name") ?? "");
  if (!response.ok) return response;
  try {
    const fields = await readPdfFields(Buffer.from(await response.arrayBuffer()));
    return Response.json({ fields }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("PDF-Formularfelder konnten nicht gelesen werden.", { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}
