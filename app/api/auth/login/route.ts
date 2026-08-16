// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildAuthorizeUrl, pkceChallenge, randomToken } from "@/lib/oidc";
import { env } from "@/lib/env";
import { allowRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Kanonischer App-Origin aus APP_BASE_URL — maßgeblich für die OIDC redirect_uri
 * (muss exakt der beim SSO registrierten URL entsprechen). Bewusst NICHT aus
 * fälschbaren Host/X-Forwarded-Host-Headern abgeleitet (SEC: Redirect-Poisoning).
 */
function appOrigin(): string {
  return env.APP_BASE_URL.replace(/\/+$/, "");
}

export async function GET(req: NextRequest) {
  // Login-Endpoint ratenbegrenzen (unauth. Session-Churn / Redirect-Amplification).
  if (!(await allowRequest("oidc-login", 30, 60_000))) {
    return new NextResponse("Zu viele Anfragen.", { status: 429 });
  }
  const nextParam = req.nextUrl.searchParams.get("next") || "/intern";
  // Nur app-interne Pfade zulassen. "//host" und "/\host" sind protokoll-
  // relative URLs → Open-Redirect-Gefahr, daher ablehnen.
  const next =
    nextParam.startsWith("/") &&
    !nextParam.startsWith("//") &&
    !nextParam.startsWith("/\\")
      ? nextParam
      : "/intern";

  const redirectUri = `${appOrigin()}/api/auth/callback`;
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(32);
  const codeChallenge = pkceChallenge(verifier);

  const session = await getSession();
  session.oauth = { state, nonce, verifier, redirectUri, next };
  await session.save();

  return NextResponse.redirect(
    await buildAuthorizeUrl({ redirectUri, state, nonce, codeChallenge }),
  );
}
