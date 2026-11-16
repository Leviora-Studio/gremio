// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse, type NextRequest } from "next/server";
import { configuredCorsOrigins, planCors } from "@/lib/cors";

/**
 * Optionale CORS-Header für `/api/public/v1` und `/api/v1` (siehe
 * `lib/cors.ts`). Ohne `CORS_ALLOWED_ORIGINS` läuft jede Anfrage unverändert
 * durch.
 */
export function middleware(req: NextRequest) {
  const plan = planCors({
    method: req.method,
    pathname: req.nextUrl.pathname,
    headers: req.headers,
    allowed: configuredCorsOrigins(),
  });
  if (plan.kind === "preflight") {
    return new NextResponse(null, { status: 204, headers: plan.headers });
  }
  const res = NextResponse.next();
  if (plan.kind === "annotate") {
    for (const [key, value] of Object.entries(plan.headers)) {
      res.headers.set(key, value);
    }
  }
  return res;
}

export const config = {
  matcher: ["/api/public/v1/:path*", "/api/v1/:path*"],
  // Node statt Edge: CORS_ALLOWED_ORIGINS wird zur Laufzeit aus der Umgebung
  // des Containers gelesen und nicht beim Build eingebacken.
  runtime: "nodejs",
};
