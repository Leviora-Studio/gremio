// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { openApiPublicSpec } from "@/lib/openapi-public";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Maschinenlesbare OpenAPI-3.1-Beschreibung der öffentlichen API. Darf
 * öffentlich sein — die beschriebenen Endpunkte sind es ebenfalls. Enthält
 * bewusst NUR /api/public/v1, nicht die Bearer-Token-API.
 */
export async function GET() {
  return NextResponse.json(openApiPublicSpec, {
    headers: { "Cache-Control": "no-store" },
  });
}
