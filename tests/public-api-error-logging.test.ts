// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { withPublicApi500 } from "../lib/public-api";

/**
 * Regressionstest zum Logging unerwarteter Fehler der öffentlichen API.
 *
 * `withPublicApi500` loggte die ERSTE ZEILE der Fehlermeldung — in der Annahme,
 * dass `DrizzleQueryError` die Query-PARAMETER erst ab Zeile zwei anhängt. Diese
 * Annahme hing am Meldungsformat einer Abhängigkeit: Ändert sie ihr Format oder
 * wirft eine andere Stelle einen Fehler, dessen Meldung einen Wert enthält,
 * landet der geheime Status-Token im Server-Log.
 *
 * Geloggt werden deshalb nur noch wertfreie Angaben (Fehlerklasse, SQLSTATE,
 * erste Stack-Zeile). Der Test hält fest, dass die MELDUNG nie im Log auftaucht
 * — auch nicht ihre erste Zeile.
 *
 * Braucht keine Datenbank.
 */

const TOKEN = "gEhEiMerStatusToken1234567890ab";

let logs: string[] = [];
let original: typeof console.error;

beforeEach(() => {
  logs = [];
  original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  };
});

afterEach(() => {
  console.error = original;
});

after(async () => {
  // lib/public-api zieht lib/db mit; Pool schließen, damit der Runner endet.
  await pool.end().catch(() => {});
});

test("Fehlermeldung mit Token landet nicht im Log", async () => {
  // Genau die Form, die Drizzle erzeugt: Query in Zeile 1, Parameter in Zeile 2.
  const err = new Error(
    `Failed query: select "id" from "cards" where "token" = $1\nparams: ${TOKEN}`,
  );
  (err as Error & { cause?: unknown }).cause = { code: "57P01" };

  const handler = withPublicApi500(async () => {
    throw err;
  });
  const res = await handler();

  assert.equal(res.status, 500);
  assert.equal(
    res.headers.get("content-type")?.includes("application/json"),
    true,
    "Die Spezifikation sichert JSON zu, kein HTML",
  );

  const gesamtesLog = logs.join("\n");
  assert.ok(gesamtesLog.length > 0, "Es soll weiterhin etwas geloggt werden");
  assert.ok(
    !gesamtesLog.includes(TOKEN),
    `Der Token darf nie im Log stehen: ${gesamtesLog}`,
  );
  assert.ok(
    !gesamtesLog.includes("Failed query"),
    "Auch die erste Zeile der Meldung gehört nicht ins Log",
  );
  // Wertfreie Diagnose bleibt erhalten.
  assert.ok(gesamtesLog.includes("57P01"), "SQLSTATE soll erhalten bleiben");
  assert.ok(gesamtesLog.includes("Error"), "Fehlerklasse soll erhalten bleiben");
});

test("Antwortkörper verrät nichts über den Fehler", async () => {
  const handler = withPublicApi500(async () => {
    throw new Error(`irgendwas mit ${TOKEN}`);
  });
  const res = await handler();
  const body = await res.text();

  assert.ok(!body.includes(TOKEN), "Kein Token in der Antwort");
  assert.ok(!body.includes("irgendwas"), "Keine Fehlermeldung in der Antwort");
  assert.ok(!body.includes("at "), "Kein Stacktrace in der Antwort");
});
