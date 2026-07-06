// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getLoanByToken } from "@/lib/inventory-loans";
import { inventoryChangeSSE } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live-Stream (SSE) der öffentlichen Anfrage-Statusseite — nur für dieses Token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const loan = await getLoanByToken(token);
  if (!loan) return new Response("Not found", { status: 404 });

  return inventoryChangeSSE(request.signal, (c) => c.token === token);
}
