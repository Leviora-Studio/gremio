// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { refreshIdentity, SESSION_TTL_SECONDS } from "../lib/auth/session-identity";

test("OIDC callback accepts optional offline access and retains live SSO validation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "gremio-login-"));
  const entry = join(dir, "callback.cjs");
  type Fixture = {
    session: Record<string, unknown>;
    tokens: Record<string, unknown>;
    introspection: Record<string, unknown> | null;
    userinfo: { sub: string } | null;
    provision: { ok: boolean; userId?: number; sessionVersion?: number; error?: string };
    saved: number;
    exchanges: number;
    verified: boolean;
  };
  const context = globalThis as unknown as { __loginTest: Fixture };
  const mocks: Record<string, string> = {
    "@/lib/env": 'export const env={APP_BASE_URL:"https://gremio.example",OIDC_CLIENT_ID:"gremio"}',
    "@/lib/auth/session": 'export async function getSession(){return globalThis.__loginTest.session} export async function saveSession(){globalThis.__loginTest.saved++}',
    "@/lib/auth/provision": 'export async function provisionUser(){return globalThis.__loginTest.provision}',
    "@/lib/oidc": `
      export async function exchangeCode(uri,code,verifier){
        if(uri!=="https://gremio.example/api/auth/callback" || code!=="code" || verifier!=="verifier") throw Error("invalid exchange");
        globalThis.__loginTest.exchanges++; return globalThis.__loginTest.tokens;
      }
      export async function verifyIdToken(token,nonce){
        if(token!=="verified-id" || nonce!=="nonce" || !globalThis.__loginTest.verified) throw Error("invalid ID token");
        return {sub:"subject"};
      }
      export async function introspectSsoToken(){return globalThis.__loginTest.introspection}
      export async function fetchUserInfo(){return globalThis.__loginTest.userinfo}
    `,
  };
  await build({
    entryPoints: [join(process.cwd(), "app/api/auth/callback/route.ts")],
    outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external",
    plugins: [{ name: "login-fixtures", setup(b) {
      b.onResolve({ filter: /^@\/lib\// }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const require = createRequire(import.meta.url), Module = require("node:module");
  const loaded = new Module(entry, module);
  loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  let sequence = 0;
  function reset(refresh = true) {
    const token = `synthetic-${++sequence}`;
    context.__loginTest = {
      session: { userId: 99, accessToken: "stale-access", refreshToken: "stale-refresh", ...refreshIdentity("stale-subject", "stale-refresh"),
        oauth: { state: "state", nonce: "nonce", verifier: "verifier", redirectUri: "https://gremio.example/api/auth/callback", next: "/intern/konto" } },
      tokens: { id_token: "verified-id", access_token: token, expires_in: 3600, scope: "openid profile email", ...(refresh ? { refresh_token: token } : {}) },
      introspection: { active: true, client_id: "gremio", sub: "subject", exp: Math.floor(Date.now() / 1000) + 3600 },
      userinfo: { sub: "subject" }, provision: { ok: true, userId: 1, sessionVersion: 3 }, saved: 0, exchanges: 0, verified: true,
    };
    return context.__loginTest;
  }
  async function login(state = "state") {
    const response = await loaded.exports.GET({ nextUrl: new URL(`https://gremio.example/api/auth/callback?code=code&state=${state}`) });
    return response.headers.get("location");
  }
  try {
    await t.test("regular refresh token works without offline scope; stale access token is removed", async () => {
      const f = reset(); const before = Date.now();
      assert.equal(await login(), "https://gremio.example/intern/konto");
      assert.equal(f.session.userId, 1); assert.equal(f.session.sessionVersion, 3);
      assert.equal(f.session.accessToken, undefined);
      assert.equal(f.session.refreshToken, f.tokens.refresh_token);
      assert.deepEqual({ ssoSubject: f.session.ssoSubject, refreshTokenHash: f.session.refreshTokenHash }, refreshIdentity("subject", f.tokens.refresh_token as string));
      assert.ok(Number(f.session.authExpiresAt) >= before + SESSION_TTL_SECONDS * 1000);
      assert.equal(f.session.oauth, undefined); assert.equal(f.saved, 1);
    });
    await t.test("offline refresh tokens without exp or sub retain their verified identity binding", async () => {
      const f = reset(); f.tokens.scope += " offline_access";
      f.introspection = { active: true, client_id: "gremio", token_type: "Offline", exp: 0 }; f.userinfo = null;
      assert.equal(await login(), "https://gremio.example/intern/konto");
    });
    await t.test("access-only login is bounded by token lifetime and clears old refresh bindings", async () => {
      const f = reset(false); const before = Date.now();
      assert.equal(await login(), "https://gremio.example/intern/konto");
      assert.equal(f.session.accessToken, f.tokens.access_token);
      for (const key of ["refreshToken", "ssoSubject", "refreshTokenHash"]) assert.equal(f.session[key], undefined);
      assert.ok(Number(f.session.authExpiresAt) >= before + 3600_000);
      assert.ok(Number(f.session.authExpiresAt) <= Date.now() + 3600_000);
    });
    await t.test("access-only tokens without sub require a matching live UserInfo identity", async () => {
      const f = reset(false); delete f.introspection!.sub;
      assert.equal(await login(), "https://gremio.example/intern/konto");
      reset(false); delete context.__loginTest.introspection!.sub; context.__loginTest.userinfo = { sub: "other" };
      assert.equal(await login(), "https://gremio.example/login?error=sso_check");
    });
    await t.test("access-only login never exceeds the 14-day maximum and needs an access token", async () => {
      const f = reset(false); f.tokens.expires_in = SESSION_TTL_SECONDS * 2;
      assert.equal(await login(), "https://gremio.example/intern/konto");
      assert.ok(Number(f.session.authExpiresAt) <= Date.now() + SESSION_TTL_SECONDS * 1000);
      reset(false).tokens.access_token = undefined;
      assert.equal(await login(), "https://gremio.example/login?error=sso_check");
    });
    await t.test("missing, expired or malformed access-token lifetimes cannot create a session", async () => {
      for (const expiry of [undefined, 0, -1, Infinity, NaN, "3600"]) {
        const f = reset(false); f.tokens.expires_in = expiry;
        assert.equal(await login(), "https://gremio.example/login?error=sso_check");
        assert.equal(f.session.userId, 99);
      }
    });
    await t.test("both token modes reject inactive tokens, outages, wrong subjects and wrong clients", async () => {
      for (const refresh of [true, false]) for (const value of [null, { active: false }, { active: true, client_id: "other", sub: "subject" }, { active: true, client_id: "gremio", sub: "other" }, { active: true, client_id: "gremio", sub: "subject", exp: 1 }]) {
        const f = reset(refresh); f.introspection = value;
        assert.equal(await login(), "https://gremio.example/login?error=sso_check");
        assert.equal(f.session.userId, 99);
      }
    });
    await t.test("state mismatch and locally inactive accounts still fail", async () => {
      const f = reset();
      assert.equal(await login("wrong"), "https://gremio.example/login?error=state");
      assert.equal(f.exchanges, 0);
      reset().provision = { ok: false, error: "inactive" };
      assert.equal(await login(), "https://gremio.example/login?error=inactive");
    });
    await t.test("invalid ID tokens still fail before establishing a new session", async sub => {
      sub.mock.method(console, "error", () => {});
      const f = reset(); f.verified = false;
      assert.equal(await login(), "https://gremio.example/login?error=callback");
      assert.equal(f.session.userId, 99);
    });
  } finally {
    delete (globalThis as { __loginTest?: Fixture }).__loginTest;
    await rm(dir, { recursive: true, force: true });
  }
});
