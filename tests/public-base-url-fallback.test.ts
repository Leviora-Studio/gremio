// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.APP_BASE_URL = "https://gremio.example/";
delete process.env.PUBLIC_BASE_URL;
process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.OIDC_ISSUER = "https://id.example";
process.env.OIDC_CLIENT_ID = "test-client";
process.env.OIDC_CLIENT_SECRET = "test-secret";

const publicApi = import("../lib/public-api");

const TOKEN = "A".repeat(30);

test("ohne PUBLIC_BASE_URL bleibt APP_BASE_URL der öffentliche Fallback", async () => {
  const { publicBaseUrl, publicApplicationLinks } = await publicApi;
  assert.equal(publicBaseUrl(), "https://gremio.example");
  assert.equal(
    publicApplicationLinks(TOKEN).statusUrl,
    `https://gremio.example/status/${TOKEN}`,
  );
});
