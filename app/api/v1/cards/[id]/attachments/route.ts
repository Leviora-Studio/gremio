// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { attachmentsApi } from "@/lib/api-card-extras";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return attachmentsApi(req, p.id);
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return attachmentsApi(req, p.id);
}
