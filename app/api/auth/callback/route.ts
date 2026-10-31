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
    const tokens = await exchangeCode(oauth.redirectUri, code, oauth.verifier);
    const claims = await verifyIdToken(tokens.id_token, oauth.nonce);
    const result = await provisionUser(claims);
    if (!result.ok) return fail(result.error);

    if (!tokens.refresh_token || tokens.scope && !tokens.scope.split(/\s+/).includes("offline_access")) return fail("sso_offline");
    const identity = refreshIdentity(claims.sub,tokens.refresh_token);
    const authExpiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    if (await checkSsoSession({userId:result.userId,refreshToken:tokens.refresh_token,...identity,authExpiresAt},claims.sub) !== "valid") return fail("sso_check");

    session.userId = result.userId;
    session.sessionVersion = result.sessionVersion;
    session.idToken = tokens.id_token;
    delete session.accessToken;
    Object.assign(session,identity,{authExpiresAt});
    session.refreshToken = tokens.refresh_token;
    session.oauth = undefined;
    await saveSession(session);

    const next = oauth.next || "/intern";
    return NextResponse.redirect(`${base}${next}`);
  } catch (e) {
    console.error("[oidc callback]", e);
    return fail("callback");
  }
}
