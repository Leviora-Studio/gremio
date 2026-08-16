// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  boardStatuses,
  boards,
  feedbackAreas,
  inventoryBoards,
  locations,
  users,
} from "../lib/db/schema";
import { createLoanBoardForInventory } from "../lib/boards";
import {
  listPublicLocations,
  submitPublicApplication,
} from "../lib/public-application-submission";
import {
  listPublicFeedbackAreas,
  submitPublicFeedback,
} from "../lib/public-feedback-submission";

/**
 * Regressionstest: Ein Standort bzw. Feedback-Bereich darf NICHT auf das
 * Leih-System-Board eines Inventars routen.
 *
 * Solche Boards tragen ausschließlich die Tracking-Karten der Leihvorgänge.
 * `getApplicationStatusByToken` / `resolveApplicationCardId` weisen Karten von
 * dort seit der Token-Trennung mit 404 ab, und die REST-API lehnt das Anlegen
 * von Karten dort mit 409 ab. Die öffentlichen Formulare kannten diese Regel
 * dagegen nicht: Ein dorthin gerouteter Standort erschien zur Auswahl, die
 * Einreichung legte die Karte an — und der Antragsteller landete direkt nach dem
 * Absenden auf einer 404-Statusseite, ohne je wieder an seinen Antrag zu kommen.
 *
 * Geprüft wird beides, weil beide Wege dieselbe Regel brauchen: die öffentliche
 * Auswahlliste (Formular + `GET /locations` bzw. `/feedback-areas`) und die
 * Einreichungslogik selbst, die das Routing eigenständig nachprüft.
 *
 * Braucht eine erreichbare Datenbank; sonst überspringt er sich selbst.
 */

let verfuegbar = false;
let aufraeumen: (() => Promise<void>) | null = null;

before(async () => {
  try {
    await db.execute("select 1");
    verfuegbar = true;
  } catch {
    verfuegbar = false;
  }
});

after(async () => {
  if (aufraeumen) await aufraeumen();
  await pool.end().catch(() => {});
});

test("Leih-System-Board ist kein gültiges Routing-Ziel", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `route-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `Route ${suffix}`, ownerId: user.id })
    .returning();
  const loanBoardId = await createLoanBoardForInventory(
    inv,
    `Route ${suffix} – Vorgänge`,
  );

  // Erste Spalte des Leihboards („Eingegangen") als Ziel missbrauchen.
  const [spalte] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, loanBoardId))
    .orderBy(asc(boardStatuses.position))
    .limit(1);
  assert.ok(spalte, "Vorbedingung: das Leihboard hat Spalten");

  // Routing direkt in der Datenbank setzen — die Admin-Aktion weist es
  // inzwischen ab, der Altbestand einer früheren Version könnte aber so
  // aussehen. Genau dagegen sichern die Abfragen unten ab.
  const [loc] = await db
    .insert(locations)
    .values({
      name: `Route ${suffix}`,
      enabled: true,
      targetBoardId: loanBoardId,
      targetStatusId: spalte.id,
    })
    .returning();
  const [area] = await db
    .insert(feedbackAreas)
    .values({
      name: `Route ${suffix}`,
      enabled: true,
      targetBoardId: loanBoardId,
      targetStatusId: spalte.id,
    })
    .returning();

  aufraeumen = async () => {
    await db.delete(locations).where(eq(locations.id, loc.id));
    await db.delete(feedbackAreas).where(eq(feedbackAreas.id, area.id));
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(boards).where(eq(boards.id, loanBoardId));
    await db.delete(users).where(eq(users.id, user.id));
  };

  // 1. Öffentliche Auswahllisten dürfen das Ziel nicht anbieten.
  assert.equal(
    (await listPublicLocations()).some((l) => l.id === loc.id),
    false,
    "Standort mit Leihboard-Ziel darf nicht im Formular/über die API erscheinen",
  );
  assert.equal(
    (await listPublicFeedbackAreas()).some((a) => a.id === area.id),
    false,
    "Feedback-Bereich mit Leihboard-Ziel darf nicht erscheinen",
  );

  // 2. Auch die Einreichung selbst muss ablehnen (sie prüft eigenständig).
  const antrag = await submitPublicApplication(
    {
      locationId: loc.id,
      title: "Testantrag",
      applicant: "Testperson",
      files: {},
    },
    { activityDetail: "Test" },
  );
  assert.equal(antrag.ok, false, "Einreichung darf nicht durchgehen");
  assert.equal(
    antrag.ok === false ? antrag.reason : "",
    "location",
    "Grund muss das ungültige Standort-Ziel sein — nicht erst die Dateiprüfung",
  );

  const feedback = await submitPublicFeedback(
    { areaId: area.id, submitterName: "Testperson", feedback: "Testtext" },
    { activityDetail: "Test" },
  );
  assert.equal(feedback.ok, false, "Feedback darf nicht durchgehen");
  assert.equal(
    feedback.ok === false ? feedback.reason : "",
    "area",
    "Grund muss der ungültige Bereich sein",
  );
});
