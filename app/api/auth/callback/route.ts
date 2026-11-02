// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse, type NextRequest } from "next/server";
import { getSession, saveSession } from "@/lib/auth/session";
import { exchangeCode, verifyIdToken } from "@/lib/oidc";
import { provisionUser } from "@/lib/auth/provision";
import { env } from "@/lib/env";
import { refreshIdentity, SESSION_TTL_SECONDS } from "@/lib/auth/session-identity";
import { checkSsoSession } from "@/lib/auth/sso";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Kanonischer Origin aus APP_BASE_URL (nicht aus fälschbaren Headern).
  const base = env.APP_BASE_URL.replace(/\/+$/, "");
  const session = await getSession();
  const oauth = session.oauth;

  const fail = async (error: string) => {
    session.oauth = undefined;
    await saveSession(session);
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(error)}`);
  };

  if (sp.get("error")) return fail(sp.get("error")!);

  const code = sp.get("code");
  const state = sp.get("state");
  if (!oauth || !code || !state || state !== oauth.state) {
    return fail("state");
  }

  try {
    const loginStartedAt = Date.now();
    const tokens = await exchangeCode(oauth.redirectUri, code, oauth.verifier);
    const claims = await verifyIdToken(tokens.id_token, oauth.nonce);
    const result = await provisionUser(claims);
    if (!result.ok) return fail(result.error);

    // Offline access is optional. A regular refresh token is also usable, but
    // remains subject to the provider's session lifetime and live revocation.
    // Without one, never let the local session outlive the access token.
    const refreshToken = tokens.refresh_token || undefined;
    if (!refreshToken && (!tokens.access_token || typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)) return fail("sso_check");
    const identity = refreshToken ? refreshIdentity(claims.sub, refreshToken) : undefined;
    const authExpiresAt = loginStartedAt + Math.min(SESSION_TTL_SECONDS, refreshToken ? SESSION_TTL_SECONDS : tokens.expires_in!) * 1000;
    const credentials = {
      refreshToken,
      accessToken: refreshToken ? undefined : tokens.access_token,
      ssoSubject: identity?.ssoSubject,
      refreshTokenHash: identity?.refreshTokenHash,
      authExpiresAt,
    };
    if (await checkSsoSession({userId:result.userId,...credentials},claims.sub) !== "valid") return fail("sso_check");

    session.userId = result.userId;
    session.sessionVersion = result.sessionVersion;
    session.idToken = tokens.id_token;
    // Explicitly replace both token modes and bindings, including stale values
    // from a previous login in this browser.
    Object.assign(session, credentials);
    session.oauth = undefined;
    await saveSession(session);

    const next = oauth.next || "/intern";
    return NextResponse.redirect(`${base}${next}`);
  } catch (e) {
    console.error("[oidc callback]", e);
    return fail("callback");
  }
}
