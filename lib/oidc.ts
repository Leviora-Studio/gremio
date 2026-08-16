// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "@/lib/env";

function trimSlash(s: string): string {
  return s.replace(/\/$/, "");
}
/** Issuer, den der Browser nutzt (authorize/logout) und gegen den wir iss prüfen. */
function publicIssuer(): string {
  return trimSlash(env.OIDC_ISSUER);
}
/** Issuer für Server-zu-Server-Aufrufe aus dem Container (token/jwks/userinfo). */
function internalIssuer(): string {
  return trimSlash(env.OIDC_INTERNAL_ISSUER || env.OIDC_ISSUER);
}

/** Öffentliche (Browser-)URL → containerinterne URL für Server-zu-Server-Calls. */
function toInternal(url: string): string {
  const pub = publicIssuer();
  const int = internalIssuer();
  if (pub !== int && url.startsWith(pub)) return int + url.slice(pub.length);
  return url;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Hochentropischer URL-sicherer Zufallswert (state, nonce, PKCE-verifier). */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

// ---------------------------------------------------------------------------
// OIDC-Discovery: Endpunkte aus /.well-known/openid-configuration laden,
// gecacht (5 min) und mit Fallback auf die Standard-Pfade, falls das SSO das
// Dokument (mal) nicht liefert. Browser-Endpunkte (authorize/logout) bleiben
// öffentlich; Server-Endpunkte (token/jwks/userinfo/revoke) werden auf den
// internen Host umgeschrieben.
// ---------------------------------------------------------------------------
type Endpoints = {
  authorize: string; // öffentlich (Browser)
  endSession: string; // öffentlich (Browser)
  token: string; // intern (Server)
  userinfo: string; // intern (Server)
  jwks: string; // intern (Server)
  revoke: string; // intern (Server)
};

function fallbackEndpoints(): Endpoints {
  const pub = publicIssuer();
  const int = internalIssuer();
  return {
    authorize: `${pub}/authorize`,
    endSession: `${pub}/logout`,
    token: `${int}/token`,
    userinfo: `${int}/userinfo`,
    jwks: `${int}/.well-known/jwks.json`,
    revoke: `${int}/revoke`,
  };
}

let epCache: { at: number; eps: Endpoints } | null = null;
const EP_TTL_MS = 5 * 60_000;

async function getEndpoints(): Promise<Endpoints> {
  const now = Date.now();
  if (epCache && now - epCache.at < EP_TTL_MS) return epCache.eps;
  let eps: Endpoints;
  try {
    const res = await fetch(
      `${internalIssuer()}/.well-known/openid-configuration`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`discovery ${res.status}`);
    const d = (await res.json()) as Record<string, string>;
    eps = {
      authorize: d.authorization_endpoint,
      endSession: d.end_session_endpoint,
      token: toInternal(d.token_endpoint),
      userinfo: toInternal(d.userinfo_endpoint),
      jwks: toInternal(d.jwks_uri),
      revoke: toInternal(d.revocation_endpoint),
    };
    // Pflicht-Endpunkte vorhanden? Sonst Fallback.
    if (!eps.authorize || !eps.token || !eps.jwks || !eps.endSession) {
      throw new Error("discovery incomplete");
    }
  } catch {
    eps = fallbackEndpoints();
  }
  epCache = { at: now, eps };
  return eps;
}

export async function buildAuthorizeUrl(p: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<string> {
  const { authorize } = await getEndpoints();
  const u = new URL(authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.OIDC_CLIENT_ID);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

type TokenResponse = {
  id_token: string;
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
};

function basicAuthHeader(): string {
  return (
    "Basic " +
    Buffer.from(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`).toString(
      "base64",
    )
  );
}

export async function exchangeCode(
  redirectUri: string,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const { token } = await getEndpoints();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const res = await fetch(token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    // Bewusst OHNE Antwortkörper: der könnte in Server-Logs landen und
    // sensible Token-Endpoint-Daten enthalten (SEC-014). Nur Status loggen.
    throw new Error(`Token-Endpoint ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as TokenResponse;
}

export type Claims = JWTPayload & {
  sub: string;
  preferred_username?: string;
  name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
};

let jwksUrl: string | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function getJwks() {
  const { jwks: url } = await getEndpoints();
  if (!jwks || jwksUrl !== url) {
    jwksUrl = url;
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export async function verifyIdToken(
  idToken: string,
  nonce: string,
): Promise<Claims> {
  const { payload } = await jwtVerify(idToken, await getJwks(), {
    issuer: publicIssuer(),
    audience: env.OIDC_CLIENT_ID,
  });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  if (!payload.sub) throw new Error("kein sub im id_token");
  return payload as Claims;
}

/**
 * Token am SSO widerrufen (RFC 7009). Best effort — Fehler blockieren den
 * Logout nicht.
 */
export async function revokeToken(
  token: string | undefined,
  hint?: "access_token" | "refresh_token",
): Promise<void> {
  if (!token) return;
  try {
    const { revoke } = await getEndpoints();
    const body = new URLSearchParams({ token });
    if (hint) body.set("token_type_hint", hint);
    await fetch(revoke, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(),
      },
      body,
      cache: "no-store",
    });
  } catch {
    /* best effort */
  }
}

/** Aktuelle Claims über den UserInfo-Endpoint laden (Bearer access_token). */
export async function fetchUserInfo(
  accessToken: string | undefined,
): Promise<Claims | null> {
  if (!accessToken) return null;
  try {
    const { userinfo } = await getEndpoints();
    const res = await fetch(userinfo, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Claims;
    return data.sub ? data : null;
  } catch {
    return null;
  }
}

export async function buildEndSessionUrl(
  idTokenHint: string | undefined,
  postLogoutRedirectUri: string,
): Promise<string> {
  const { endSession } = await getEndpoints();
  const u = new URL(endSession);
  if (idTokenHint) u.searchParams.set("id_token_hint", idTokenHint);
  u.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return u.toString();
}

/**
 * Profilbild aus dem SSO laden (Host public→internal tauschen für Container).
 * SSRF-Schutz: Es werden NUR URLs der SSO-Origin geladen (das `picture`-Claim
 * ist nutzerkontrolliert) — sonst könnte ein Nutzer interne Hosts anfragen
 * lassen. Zusätzlich: keine Redirects, Timeout und Größenlimit.
 */
export async function fetchPicture(pictureUrl: string): Promise<Buffer | null> {
  let parsed: URL;
  try {
    parsed = new URL(pictureUrl);
  } catch {
    return null;
  }
  const allowedOrigins = new Set([
    new URL(publicIssuer()).origin,
    new URL(internalIssuer()).origin,
  ]);
  if (!allowedOrigins.has(parsed.origin)) return null;

  const MAX_PICTURE_BYTES = 5_000_000; // 5 MB
  try {
    const res = await fetch(toInternal(pictureUrl), {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    // Vorab anhand Content-Length ablehnen, falls vorhanden …
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PICTURE_BYTES) return null;

    // … und beim Lesen hart begrenzen (Content-Length kann fehlen oder lügen),
    // damit eine bösartige/kompromittierte SSO nicht beliebig viel in den
    // Speicher streamen kann. Bei Überschreitung abbrechen.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_PICTURE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
