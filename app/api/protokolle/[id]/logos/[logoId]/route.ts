// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getCurrentUser } from "@/lib/auth";
import { canAccessProtocolArea, getProtocolAreaById } from "@/lib/protocols";
import { getProtocolLogoBytes } from "@/lib/protocol-logos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; logoId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, logoId } = await params;
  const areaId = Number(id);
  const logo = Number(logoId);
  if (!Number.isSafeInteger(areaId) || areaId < 1 || !Number.isSafeInteger(logo) || logo < 1) return new Response("Not found", { status: 404 });
  const area = await getProtocolAreaById(areaId);
  if (!area || !(await canAccessProtocolArea(user, area))) return new Response("Not found", { status: 404 });
  const bytes = await getProtocolLogoBytes(areaId, logo);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Length": String(bytes.length) } });
}
