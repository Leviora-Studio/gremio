// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { createHmac } from "node:crypto";
import { rateLimit } from "@/lib/rate-limit";
import { deriveKey } from "@/lib/crypto";
import { readLimitedBody } from "@/lib/public-api";
export function oauthJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
export function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}
export function oauthRate(req: Request, scope: string, limit = 60) {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const key = createHmac("sha256", deriveKey("mcp-rate-limit"))
    .update(ip)
    .digest("hex");
  return rateLimit(`mcp-${scope}:${key}`, limit, 60_000);
}
export async function oauthForm(req: Request) {
  if (
    req.headers.get("content-type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    return null;
  const body = await readLimitedBody(req, 16384);
  if (!body.ok) return null;
  const params = new URLSearchParams(new TextDecoder().decode(body.body));
  for (const key of params.keys())
    if (params.getAll(key).length !== 1) return null;
  return params;
}
