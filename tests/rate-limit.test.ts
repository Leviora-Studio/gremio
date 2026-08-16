// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  rateLimit,
  rateLimitDetailed,
  __resetRateLimitForTests,
} from "../lib/rate-limit";

/**
 * Regressionstest zum Aussperr-Fehler: Früher teilten sich ALLE Scopes eine
 * globale Map mit hartem Deckel. War die voll und ließ sich nichts aufräumen,
 * lieferte der Limiter für jeden Schlüssel ohne laufenden Bucket `false` — auch
 * für `oidc-login`. Genug verschiedene Quell-IPs sperrten damit die gesamte
 * Anmeldung aus.
 *
 * Ohne die Trennung nach Scope-Familie schlägt dieser Test fehl.
 */

beforeEach(() => __resetRateLimitForTests());

test("geflutete öffentliche Familie sperrt die Anmeldung nicht aus", () => {
  // Eine öffentliche Familie weit über ihren Deckel hinaus fluten.
  for (let i = 0; i < 30_000; i++) {
    rateLimit(`public-api-submit-day:ip${i}`, 500, 60 * 60 * 1000);
  }

  // Kritisch: Anmeldung und interne Aktionen müssen weiterhin durchkommen.
  assert.equal(rateLimit("oidc-login:frischer-client", 30, 60_000), true);
  assert.equal(rateLimit("pdf-save:42:frischer-client", 30, 60_000), true);
  assert.equal(rateLimit("submit:frischer-client", 20, 60_000), true);

  // Auch die detaillierte Variante (die JSON-API) darf nicht fail-closed werden.
  const detailed = rateLimitDetailed("oidc-login:noch-einer", 30, 60_000);
  assert.equal(detailed.allowed, true);
});

test("gefluteter Speicher verdrängt statt abzuweisen", () => {
  const familie = "public-api-status";
  for (let i = 0; i < 30_000; i++) {
    rateLimit(`${familie}:ip${i}`, 600, 60_000);
  }
  // Auch innerhalb DERSELBEN Familie darf ein neuer Client nicht abgewiesen
  // werden — das Limit wird höchstens weicher.
  assert.equal(rateLimit(`${familie}:ganz-neu`, 600, 60_000), true);
});

test("das Limit selbst greift weiterhin", () => {
  let erlaubt = 0;
  for (let i = 0; i < 25; i++) {
    if (rateLimit("submit:derselbe-client", 20, 60_000)) erlaubt++;
  }
  assert.equal(erlaubt, 20);

  // Ein anderer Scope hat einen eigenen Zähler.
  assert.equal(rateLimit("feedback-submit:derselbe-client", 20, 60_000), true);
});

test("Retry-After wird bei Ablehnung gemeldet", () => {
  for (let i = 0; i < 20; i++) {
    rateLimitDetailed("submit:client-x", 20, 60_000);
  }
  const res = rateLimitDetailed("submit:client-x", 20, 60_000);
  assert.equal(res.allowed, false);
  assert.ok(res.retryAfterSec > 0 && res.retryAfterSec <= 60);
});
