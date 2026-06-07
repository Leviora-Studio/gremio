// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { cardChangeSSE } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live-Stream (SSE) für die öffentliche Statusseite — nur für genau dieses Token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.token, token))
    .limit(1);
  if (!card) return new Response("Not found", { status: 404 });

  return cardChangeSSE(request.signal, (c) => c.token === token);
}
