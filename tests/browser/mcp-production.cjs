// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

// Production HTTP + browser OAuth consent using an isolated DB and local OIDC mock.
// Never uses real identities, cloud files, or the normal app upload directory.
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { randomUUID, createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Pool } = require("pg");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  assert.match(
    new URL(process.env.DATABASE_URL).pathname,
    /^\/gremio_workflows_test_/,
  );
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const query = (text, args = []) => pool.query(text, args);
  const output = mkdtempSync(join(tmpdir(), "gremio-mcp-browser-"));
  const suffix = `mcp-browser-${randomUUID()}`;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "local-test-key",
    alg: "RS256",
    use: "sig",
  };
  const loginCodes = new Map();
  let callback,
    oidcLogins = 0,
    browser,
    child,
    userId,
    clientId,
    boardIds = [],
    mcpClient,
    serverLog = "";
  let issuer;
  const mock = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      const json = (data) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(data));
      };
      if (url.pathname === "/.well-known/openid-configuration")
        return json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          userinfo_endpoint: issuer + "/userinfo",
          end_session_endpoint: issuer + "/logout",
          revocation_endpoint: issuer + "/revoke",
        });
      if (url.pathname === "/jwks") return json({ keys: [jwk] });
      if (url.pathname === "/authorize") {
        oidcLogins++;
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const code = randomUUID();
        loginCodes.set(code, Object.fromEntries(url.searchParams));
        const target = new URL(url.searchParams.get("redirect_uri"));
        target.searchParams.set("code", code);
        target.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { location: target.toString() });
        return res.end();
      }
      if (url.pathname === "/token") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const p = new URLSearchParams(body),
          original = loginCodes.get(p.get("code"));
        assert.ok(original);
        loginCodes.delete(p.get("code"));
        assert.equal(
          createHash("sha256")
            .update(p.get("code_verifier"))
            .digest("base64url"),
          original.code_challenge,
        );
        const idToken = await new SignJWT({
          nonce: original.nonce,
          preferred_username: suffix,
          name: "Lokaler MCP-Test",
        })
          .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
          .setIssuer(issuer)
          .setAudience("gremio-test")
          .setSubject(suffix)
          .setIssuedAt()
          .setExpirationTime("10m")
          .sign(privateKey);
        return json({
          id_token: idToken,
          access_token: "local-oidc-access",
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/mcp-callback") {
        callback = url;
        res.end("Verbindung hergestellt");
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(500);
      res.end("Local mock failed");
      console.error(error);
    }
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${mock.address().port}`;
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    userId = (
      await query("insert into users(username) values ($1) returning id", [
        suffix,
      ])
    ).rows[0].id;
    boardIds = (
      await query(
        "insert into boards(name,owner_id) values ($1,$3),($2,$3) returning id",
        ["Anträge Köthen – Test", "Veranstaltungen – Test", userId],
      )
    ).rows.map((r) => r.id);
    for (const id of boardIds) {
      await query(
        "insert into board_statuses(board_id,name,position) values ($1,'Eingegangen',0)",
        [id],
      );
      await query(
        "insert into board_card_fields(board_id,field_key,visible) values ($1,'assignee',true)",
        [id],
      );
    }
    child = spawn(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      {
        env: {
          ...process.env,
          APP_BASE_URL: base,
          PUBLIC_BASE_URL: base,
          OIDC_ISSUER: issuer,
          OIDC_INTERNAL_ISSUER: issuer,
          OIDC_CLIENT_ID: "gremio-test",
          OIDC_CLIENT_SECRET: "local-test-secret",
          UPLOAD_DIR: join(output, "uploads"),
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (d) => (serverLog += d));
    child.stderr.on("data", (d) => (serverLog += d));
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, serverLog);
    const discovery = await fetch(
      base + "/.well-known/oauth-authorization-server",
    );
    assert.equal(discovery.status, 200);
    assert.equal((await discovery.json()).issuer, base);
    const unauthorized = await fetch(base + "/api/mcp");
    assert.equal(unauthorized.status, 401);
    assert.match(
      unauthorized.headers.get("www-authenticate"),
      /resource_metadata/,
    );
    const redirect = issuer + "/mcp-callback";
    const registration = await fetch(base + "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Lokaler Test-Agent",
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registration.status, 201);
    clientId = (await registration.json()).client_id;
    const verifier = "k".repeat(43),
      resource = base + "/api/mcp";
    const auth = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource,
      scope: "gremio",
      state: "browser-state",
    });
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(base + "/oauth/authorize?" + auth);
    await page.getByRole("heading", { name: "Mit Gremio verbinden" }).waitFor();
    assert.equal(
      oidcLogins,
      1,
      "actual OIDC redirects and signed ID token verification",
    );
    assert.equal(
      await page.locator("input[name=scope][value=read]").isChecked(),
      true,
    );
    assert.equal(await page.locator("input[name=boardId]:checked").count(), 0);
    await page.screenshot({
      path: join(output, "consent-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, "consent-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.setViewportSize({ width: 1400, height: 1000 });
    const style = await page.addStyleTag({
      content: "html { font-size: 200% !important; }",
    });
    await page.screenshot({
      path: join(output, "consent-text-200.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await style.evaluate((el) => el.remove());
    await page.getByRole("button", { name: "Zugriff erlauben" }).click();
    await page.getByText("Bitte mindestens ein Board auswählen.", { exact: true }).waitFor();
    await page.locator(`input[name=boardId][value="${boardIds[0]}"]`).check();
    await page.getByRole("button", { name: "Zugriff erlauben" }).click();
    await page.waitForURL(issuer + "/mcp-callback?**");
    assert.equal(callback.searchParams.get("state"), "browser-state");
    const tokenResponse = await fetch(base + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code"),
        client_id: clientId,
        redirect_uri: redirect,
        code_verifier: verifier,
        resource,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    mcpClient = new Client({ name: "production-test", version: "1" });
    await mcpClient.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        },
      }),
    );
    const tools = await mcpClient.listTools();
    assert.equal(tools.tools.length, 21);
    const call = (name, args = {}) =>
      mcpClient.callTool({ name, arguments: args });
    let result = await call("list_boards");
    assert.deepEqual(
      result.structuredContent.boards.map((b) => b.id),
      [boardIds[0]],
    );
    result = await call("create_card", {
      id: boardIds[0],
      data: { title: "Should fail" },
    });
    assert.equal(result.isError, true);
    await page.goto(base + "/intern/konto/verbindungen");
    await page.getByRole("heading", { name: "Lokaler Test-Agent" }).waitFor();
    await page.locator("input[name=scope][value=write]").check();
    await page.locator(`input[name=boardId][value="${boardIds[0]}"]`).uncheck();
    await page.locator(`input[name=boardId][value="${boardIds[1]}"]`).check();
    await page.getByRole("button", { name: "Freigabe speichern" }).click();
    await page.waitForTimeout(400);
    await page.reload();
    assert.equal(
      await page.locator("input[name=scope][value=write]").isChecked(),
      true,
    );
    result = await call("list_boards");
    assert.deepEqual(
      result.structuredContent.boards.map((b) => b.id),
      [boardIds[1]],
    );
    result = await call("create_card", {
      id: boardIds[1],
      data: { title: "Created through real MCP" },
    });
    assert.equal(result.isError, false);
    await page.screenshot({
      path: join(output, "connections-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, "connections-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.getByRole("button", { name: "Zugriff widerrufen" }).click();
    await page.getByText("Noch keine Anwendungen verbunden.").waitFor();
    const revoked = await fetch(resource, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(revoked.status, 401);
    // Existing browser session returns directly to consent without another OIDC login.
    await page.goto(base + "/oauth/authorize?" + auth);
    await page.getByRole("heading", { name: "Mit Gremio verbinden" }).waitFor();
    assert.equal(oidcLogins, 1);
    await page.getByRole("button", { name: "Ablehnen" }).click();
    await page.waitForURL(issuer + "/mcp-callback?**");
    assert.equal(callback.searchParams.get("error"), "access_denied");
    console.log(
      "PASS: OIDC login, consent, no-board validation, SDK MCP handshake/tools, live rights editing, revocation, denial, desktop/mobile and 200% text.",
    );
    console.log("Screenshots: " + output);
  } catch (error) {
    writeFileSync(join(output, "server.log"), serverLog);
    console.error("Diagnostics: " + output);
    throw error;
  } finally {
    await mcpClient?.close().catch(() => {});
    await browser?.close();
    if (child) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await new Promise((resolve) => mock.close(resolve));
    if (clientId)
      await query("delete from mcp_clients where id=$1", [clientId]);
    if (boardIds.length)
      await query("delete from boards where id=any($1::int[])", [boardIds]);
    if (userId) await query("delete from users where id=$1", [userId]);
    await pool.end();
    rmSync(join(output, "uploads"), { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
