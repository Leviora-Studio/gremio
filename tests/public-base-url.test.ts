// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";

// Getrennte Origins wie im Produktivbetrieb. Vor dem dynamischen Import setzen,
// weil lib/env die validierte Konfiguration beim ersten Zugriff cached.
process.env.APP_BASE_URL = "https://gremio.example";
process.env.PUBLIC_BASE_URL = "https://antrag.example";
process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.OIDC_ISSUER = "https://id.example";
process.env.OIDC_CLIENT_ID = "test-client";
process.env.OIDC_CLIENT_SECRET = "test-secret";

const modules = Promise.all([
  import("../lib/public-api"),
  import("../lib/public-status-url"),
]);

const TOKEN = "A".repeat(30);

test("neue öffentliche Links verwenden ausschließlich PUBLIC_BASE_URL", async () => {
  const [{ publicApplicationLinks, publicBaseUrl, publicFeedbackLinks }, status] =
    await modules;
  assert.equal(publicBaseUrl(), "https://antrag.example");
  assert.deepEqual(publicApplicationLinks(TOKEN), {
    statusUrl: `https://antrag.example/status/${TOKEN}`,
    receiptPdfUrl: `https://antrag.example/status/${TOKEN}/pdf`,
  });
  assert.deepEqual(publicFeedbackLinks(TOKEN), {
    statusUrl: `https://antrag.example/feedback/status/${TOKEN}`,
    receiptPdfUrl: `https://antrag.example/feedback/status/${TOKEN}/pdf`,
  });
  assert.equal(
    status.attachmentUrlFor(TOKEN, 42),
    `https://antrag.example/api/status/${TOKEN}/attachment/42`,
  );
  assert.deepEqual(
    status.parseStatusLink(`https://antrag.example/status/${TOKEN}`),
    {
      ok: true,
      kind: "application",
      token: TOKEN,
    },
  );
});

test("bestehende Statuslinks unter APP_BASE_URL bleiben gültig", async () => {
  const [, { parseStatusLink, statusLinksFor }] = await modules;
  assert.deepEqual(parseStatusLink(`https://gremio.example/status/${TOKEN}`), {
    ok: true,
    kind: "application",
    token: TOKEN,
  });
  assert.deepEqual(
    parseStatusLink(`https://gremio.example/feedback/status/${TOKEN}`),
    { ok: true, kind: "feedback", token: TOKEN },
  );

  // Auch bei einem Legacy-Eingang antwortet die API mit dem neuen kanonischen
  // Link; sie übernimmt niemals den Origin aus der Eingabe.
  assert.deepEqual(statusLinksFor("application", TOKEN), {
    statusUrl: `https://antrag.example/status/${TOKEN}`,
    receiptPdfUrl: `https://antrag.example/status/${TOKEN}/pdf`,
  });
});

test("fremde Origins bleiben abgewiesen", async () => {
  const [, { parseStatusLink }] = await modules;
  assert.deepEqual(parseStatusLink(`https://evil.example/status/${TOKEN}`), {
    ok: false,
    reason: "origin",
  });
});
