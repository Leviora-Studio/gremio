// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { exchangeCode, verifyIdToken } from "@/lib/oidc";
import { provisionUser } from "@/lib/auth/provision";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Kanonischer Origin aus APP_BASE_URL (nicht aus fälschbaren Headern).
  const base = env.APP_BASE_URL.replace(/\/+$/, "");
  const session = await getSession();
  const oauth = session.oauth;

  const fail = async (error: string) => {
    session.oauth = undefined;
    await session.save();
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

    session.userId = result.userId;
    session.idToken = tokens.id_token;
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.oauth = undefined;
    await session.save();

    const next = oauth.next || "/intern";
    return NextResponse.redirect(`${base}${next}`);
  } catch (e) {
    console.error("[oidc callback]", e);
    return fail("callback");
  }
}
