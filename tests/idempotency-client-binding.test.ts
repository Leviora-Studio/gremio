// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { isIdempotencyConflict } from "../lib/public-api-idempotency";

/**
 * Regressionstest zur Client-Bindung des Idempotency-Key.
 *
 * Ein Replay gibt den GEHEIMEN Status-Link der ursprünglichen Einreichung
 * zurück. Vorher entschied allein der Request-Fingerprint darüber: Wer einen
 * fremden Schlüssel erriet oder abfing und dieselben Daten schickte, bekam den
 * Vorgang eines anderen Einreichers. Beim Feedback besteht der Fingerprint nur
 * aus Bereich, Name und Text — also aus Angaben, die Mitwissende kennen können.
 *
 * Seitdem wird zusätzlich eine pseudonyme Client-Kennung gespeichert; passt sie
 * nicht, gilt der Treffer als Konflikt (409) statt als Replay.
 *
 * Braucht keine Datenbank — geprüft wird die reine Entscheidungsregel.
 */

const DATEN = "fingerprint-der-einreichung";
const CLIENT_A = "hmac-client-a";
const CLIENT_B = "hmac-client-b";

after(async () => {
  // lib/public-api-idempotency zieht lib/db mit; Pool schließen.
  await pool.end().catch(() => {});
});

test("gleiche Daten, gleicher Client → Replay", () => {
  assert.equal(
    isIdempotencyConflict(
      { requestHash: DATEN, clientHash: CLIENT_A },
      DATEN,
      CLIENT_A,
    ),
    false,
  );
});

test("gleiche Daten, ANDERER Client → Konflikt (kein Status-Link)", () => {
  assert.equal(
    isIdempotencyConflict(
      { requestHash: DATEN, clientHash: CLIENT_A },
      DATEN,
      CLIENT_B,
    ),
    true,
    "Ein fremder Client darf über einen erratenen Schlüssel nie den Status-Link erhalten",
  );
});

test("andere Daten → Konflikt, unabhängig vom Client", () => {
  for (const client of [CLIENT_A, CLIENT_B]) {
    assert.equal(
      isIdempotencyConflict(
        { requestHash: DATEN, clientHash: CLIENT_A },
        "anderer-fingerprint",
        client,
      ),
      true,
    );
  }
});

test("Altbestand ohne Client-Kennung bleibt replay-fähig", () => {
  // Zeilen aus der Zeit vor der Bindung dürfen nicht plötzlich 409 liefern —
  // sie verfallen ohnehin über IDEMPOTENCY_TTL_DAYS.
  assert.equal(
    isIdempotencyConflict({ requestHash: DATEN, clientHash: null }, DATEN, CLIENT_B),
    false,
  );
  // Aber auch dort schlägt eine Datenabweichung weiterhin durch.
  assert.equal(
    isIdempotencyConflict(
      { requestHash: DATEN, clientHash: null },
      "anderer-fingerprint",
      CLIENT_A,
    ),
    true,
  );
});
