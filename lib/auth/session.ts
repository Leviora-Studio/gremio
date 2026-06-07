// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getIronSession, type SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";

export interface SessionData {
  userId?: number;
  // OIDC id_token (für RP-initiated logout / end_session id_token_hint)
  idToken?: string;
  // OIDC access_token (UserInfo-Resync) + refresh_token — beim Logout am SSO
  // widerrufen (RFC 7009).
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
