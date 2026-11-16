// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  configuredCorsOrigins,
  corsScopeForPath,
  parseCorsAllowedOrigins,
  planCors,
} from "../lib/cors";
import { middleware, config } from "../middleware";

const ALLOWED = new Set(["https://www.example.org", "http://localhost:5173"]);

function plan(
  pathname: string,
  headers: Record<string, string>,
  method = "GET",
  allowed: ReadonlySet<string> = ALLOWED,
) {
  return planCors({ method, pathname, headers: new Headers(headers), allowed });
}

test("CORS_ALLOWED_ORIGINS wird zu exakten, normalisierten Origins", () => {
  assert.deepEqual(parseCorsAllowedOrigins(undefined), { ok: true, origins: new Set() });
  assert.deepEqual(parseCorsAllowedOrigins("  "), { ok: true, origins: new Set() });
  const parsed = parseCorsAllowedOrigins(
    "https://WWW.Example.org/, https://app.example.org:443\nhttp://localhost:5173 https://bücher.example,https://www.example.org",
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    [...(parsed.ok ? parsed.origins : [])],
    [
      "https://www.example.org",
      "https://app.example.org",
      "http://localhost:5173",
      "https://xn--bcher-kva.example",
    ],
  );
});

test("Platzhalter, Pfade, Zugangsdaten und fremde Schemata werden abgewiesen", () => {
  for (const invalid of [
    "*",
    "https://*.example.org",
    "www.example.org",
    "https://example.org/app",
    "https://example.org/?x=1",
    "https://example.org/#top",
    "https://user:pw@example.org",
    "ftp://example.org",
    "javascript:alert(1)",
    "null",
  ]) {
    const parsed = parseCorsAllowedOrigins(`https://ok.example, ${invalid}`);
    assert.equal(parsed.ok, false, invalid);
    assert.equal(parsed.ok ? 0 : parsed.errors.length, 1, invalid);
  }
});

test("ein ungültiger Wert schaltet CORS ab, statt teilweise freizugeben", () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.equal(configuredCorsOrigins("https://ok.example, *").size, 0);
    assert.equal(logged.length, 1);
    assert.deepEqual([...configuredCorsOrigins("https://ok.example")], ["https://ok.example"]);
    assert.equal(configuredCorsOrigins(undefined).size, 0);
  } finally {
    console.error = originalError;
  }
});

test("nur die öffentliche API und die Bearer-API sind betroffen", () => {
  assert.equal(corsScopeForPath("/api/public/v1"), "public");
  assert.equal(corsScopeForPath("/api/public/v1/applications"), "public");
  assert.equal(corsScopeForPath("/api/v1"), "internal");
  assert.equal(corsScopeForPath("/api/v1/cards/7/attachments/3"), "internal");
  for (const other of [
    "/",
    "/intern",
    "/api/mcp",
    "/api/mcp/attachments/1/2",
    "/oauth/token",
    "/api/status/abc/attachment/1",
    "/api/app/stream",
    "/api/public/docs",
    "/api/v10",
    "/api/v1x/boards",
    "/api/public/v1x",
  ]) {
    assert.equal(corsScopeForPath(other), null, other);
    assert.deepEqual(plan(other, { origin: "https://www.example.org" }), { kind: "pass" }, other);
  }
});

test("ohne Konfiguration bleibt jede Antwort unverändert", () => {
  assert.deepEqual(
    plan("/api/public/v1/locations", { origin: "https://www.example.org" }, "GET", new Set()),
    { kind: "pass" },
  );
});

test("erlaubte Origin erhält ACAO ohne Credentials, andere nur Vary", () => {
  const allowed = plan("/api/public/v1/locations", { origin: "https://www.example.org" });
  assert.deepEqual(allowed, {
    kind: "annotate",
    headers: {
      "Access-Control-Allow-Origin": "https://www.example.org",
      "Access-Control-Expose-Headers": "Retry-After",
      Vary: "Origin",
    },
  });
  for (const origin of ["https://evil.example", "null", "https://WWW.EXAMPLE.ORG", "https://www.example.org.evil.example"]) {
    assert.deepEqual(plan("/api/v1/boards", { origin }), { kind: "annotate", headers: { Vary: "Origin" } }, origin);
  }
  assert.deepEqual(plan("/api/v1/boards", {}), { kind: "annotate", headers: { Vary: "Origin" } });
  const internal = plan("/api/v1/cards/1", { origin: "http://localhost:5173" });
  assert.equal(internal.kind, "annotate");
  assert.equal(internal.kind === "annotate" && internal.headers["Access-Control-Expose-Headers"], "Retry-After, Content-Disposition");
  for (const p of [allowed, internal]) {
    assert.equal(p.kind !== "pass" && "Access-Control-Allow-Credentials" in p.headers, false);
  }
});

test("Preflights werden je API mit festen Methoden und Headern beantwortet", () => {
  const preflightHeaders = {
    origin: "https://www.example.org",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type, idempotency-key",
  };
  assert.deepEqual(plan("/api/public/v1/applications", preflightHeaders, "OPTIONS"), {
    kind: "preflight",
    headers: {
      "Access-Control-Allow-Origin": "https://www.example.org",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
      "Access-Control-Max-Age": "600",
      Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    },
  });
  const internal = plan("/api/v1/cards/9", { ...preflightHeaders, "access-control-request-method": "PATCH" }, "OPTIONS");
  assert.equal(internal.kind, "preflight");
  assert.equal(internal.kind === "preflight" && internal.headers["Access-Control-Allow-Methods"], "GET, POST, PATCH, DELETE, OPTIONS");
  assert.equal(internal.kind === "preflight" && internal.headers["Access-Control-Allow-Headers"], "Authorization, Content-Type");
  // Fremde Origin: kein Preflight-Erfolg, nur Vary (Next beantwortet OPTIONS ohne ACAO).
  assert.deepEqual(
    plan("/api/v1/cards/9", { ...preflightHeaders, origin: "https://evil.example" }, "OPTIONS"),
    { kind: "annotate", headers: { Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers" } },
  );
  // OPTIONS ohne Access-Control-Request-Method ist kein Preflight.
  assert.equal(plan("/api/v1/cards/9", { origin: "https://www.example.org" }, "OPTIONS").kind, "annotate");
});

test("Middleware liest CORS_ALLOWED_ORIGINS zur Laufzeit und setzt die Header", () => {
  assert.deepEqual(config.matcher, ["/api/public/v1/:path*", "/api/v1/:path*"]);
  assert.equal(config.runtime, "nodejs");
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  try {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const off = middleware(
      new NextRequest("http://gremio.test/api/public/v1/locations", { headers: { origin: "https://www.example.org" } }),
    );
    assert.equal(off.headers.get("x-middleware-next"), "1");
    assert.equal(off.headers.get("access-control-allow-origin"), null);
    assert.equal(off.headers.get("vary"), null);

    process.env.CORS_ALLOWED_ORIGINS = "https://www.example.org";
    const on = middleware(
      new NextRequest("http://gremio.test/api/public/v1/locations", { headers: { origin: "https://www.example.org" } }),
    );
    assert.equal(on.headers.get("x-middleware-next"), "1");
    assert.equal(on.headers.get("access-control-allow-origin"), "https://www.example.org");
    assert.equal(on.headers.get("access-control-allow-credentials"), null);
    assert.equal(on.headers.get("vary"), "Origin");

    const preflight = middleware(
      new NextRequest("http://gremio.test/api/v1/boards", {
        method: "OPTIONS",
        headers: { origin: "https://www.example.org", "access-control-request-method": "GET" },
      }),
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("x-middleware-next"), null);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://www.example.org");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Authorization, Content-Type");
  } finally {
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});

test("ungültige CORS_ALLOWED_ORIGINS stoppt die Umgebungsvalidierung", async () => {
  Object.assign(process.env, {
    AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
    ENCRYPTION_KEY: "0".repeat(64),
    OIDC_ISSUER: "https://id.example",
    OIDC_CLIENT_ID: "test-client",
    OIDC_CLIENT_SECRET: "test-secret",
  });
  const { getEnv } = await import("../lib/env");
  const originalError = console.error;
  console.error = () => {};
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  try {
    process.env.CORS_ALLOWED_ORIGINS = "https://ok.example,*";
    assert.throws(() => getEnv(), /Ungültige Umgebungsvariablen/);
    process.env.CORS_ALLOWED_ORIGINS = "https://ok.example, http://localhost:5173";
    assert.equal(getEnv().CORS_ALLOWED_ORIGINS, "https://ok.example, http://localhost:5173");
  } finally {
    console.error = originalError;
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});
