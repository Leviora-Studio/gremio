// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getIronSession, type SessionOptions, type IronSession } from "iron-session";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { SESSION_TTL_SECONDS } from "./session-identity";

export interface SessionData {
  userId?: number;
  sessionVersion?: number;
  authExpiresAt?: number;
  ssoSubject?: string;
  refreshTokenHash?: string;
  // OIDC id_token (für RP-initiated logout / end_session id_token_hint)
  idToken?: string;
  // Access token retained only for legacy sessions; new logins keep the offline
  // refresh token, revoked at logout (RFC 7009).
  accessToken?: string;
  refreshToken?: string;
  // Transienter OIDC-Flow-State zwischen /login-Redirect und /callback
  oauth?: {
    state: string;
    nonce: string;
    verifier: string;
    redirectUri: string;
    next: string;
  };
}

const sessionOptions: SessionOptions = {
  password: env.AUTH_SECRET,
  cookieName: "gremio_session",
  ttl: SESSION_TTL_SECONDS,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};

/**
 * Secure-Flag fürs Session-Cookie. In Produktion IMMER an — der echte Client
 * erreicht die App ausschließlich über https (nginx terminiert TLS). Bewusst
 * NICHT aus dem fälschbaren `x-forwarded-proto` abgeleitet (SEC-009). Nur in der
 * lokalen Entwicklung (http) wird es protokollabhängig bestimmt, sonst hielte
 * der Login dort nicht.
 */
async function isHttps(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return true;
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return !host.startsWith("localhost") && !host.startsWith("127.");
}

export async function getSession() {
  const cookieStore = await cookies();
  const secure = await isHttps();
  return getIronSession<SessionData>(cookieStore, {
    ...sessionOptions,
    cookieOptions: { ...sessionOptions.cookieOptions, secure },
  });
}


/** Preserve the original login deadline when other actions update the cookie. */
export async function saveSession(session: IronSession<SessionData>): Promise<void> {
  const ttl = session.oauth ? 10 * 60 : typeof session.authExpiresAt === "number"
    ? Math.max(1, Math.ceil((session.authExpiresAt - Date.now()) / 1000)) : SESSION_TTL_SECONDS;
  // The ID token is only a logout hint; reserve room for OAuth metadata.
  // The stable refresh token and verified subject are sufficient for live SSO checks.
  if (session.idToken && Buffer.byteLength(JSON.stringify(session), "utf8") > 2400) delete session.idToken;
  session.updateConfig({...sessionOptions, ttl, cookieOptions:{...sessionOptions.cookieOptions, secure:await isHttps(), maxAge:ttl}});
  await session.save();
}
