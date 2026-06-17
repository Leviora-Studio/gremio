// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getCurrentUser } from "@/lib/auth";
import { readSignature } from "@/lib/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unterschriftsbild des eingeloggten Nutzers (nur für die eigene Vorschau). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.signaturePath) return new Response("Not found", { status: 404 });
  const buf = await readSignature(user.signaturePath);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
