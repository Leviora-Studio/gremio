// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { exchangeMcpToken } from "@/lib/mcp-oauth";
import { oauthError, oauthForm, oauthJson, oauthRate } from "@/lib/mcp-http";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!oauthRate(req, "token"))
    return oauthError("temporarily_unavailable", "Zu viele Anfragen.", 429);
  const p = await oauthForm(req);
  if (!p || p.has("client_secret") || req.headers.has("authorization"))
    return oauthError(
      "invalid_request",
      "Public Client mit PKCE erforderlich.",
    );
  const result = await exchangeMcpToken(p);
  return result
    ? oauthJson(result)
    : oauthError("invalid_grant", "Ungültige oder abgelaufene Freigabe.");
}
