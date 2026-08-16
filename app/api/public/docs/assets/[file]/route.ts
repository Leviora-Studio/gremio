// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { serveSwaggerAsset } from "@/lib/swagger-ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bisheriger Asset-Pfad der öffentlichen Swagger UI. Die Auslieferung liegt
 * inzwischen in `lib/swagger-ui.ts` und wird mit der internen Doku geteilt;
 * diese Route bleibt bestehen, damit bereits verlinkte/gebookmarkte URLs
 * weiterhin funktionieren.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  return serveSwaggerAsset(file);
}
