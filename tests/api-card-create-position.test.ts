// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { boards, boardStatuses, cards, users } from "../lib/db/schema";
import { createCardViaApi } from "../lib/api-cards";

/**
 * Regressionstest zum ignorierten `position`-Feld beim Karten-ANLEGEN über die
 * REST-API: Die OpenAPI-Spezifikation sagt „ohne `position` am Ende der
 * Spalte" zu — mit `position` also an genau dieser Stelle. `createCardViaApi`
 * las das Feld aber nie: Der Client bekam 201 ohne Fehler, die Karte lag
 * trotzdem immer am Spaltenende (stiller Kontraktbruch; `repositionCard` lief
 * nur im PATCH-Pfad).
 *
 * Ohne den Fix schlägt der erste Test hier fehl (neue Karte landet auf
 * Position 2 statt 0).
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

test("POST-Karte mit position=0 landet am Spaltenanfang", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `cardpos-${suffix}`, role: "admin" })
    .returning();
  const [board] = await db
    .insert(boards)
    .values({ name: `CardPos ${suffix}`, ownerId: user.id })
    .returning();
  const [col] = await db
    .insert(boardStatuses)
    .values({ boardId: board.id, name: "Eingegangen", position: 0 })
    .returning();

  aufraeumen = async () => {
    await db.delete(cards).where(eq(cards.boardId, board.id));
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  // Zwei bestehende Karten in der Spalte (Positionen 0 und 1).
  const first = await createCardViaApi(user, board, { title: "Alt A" });
  const second = await createCardViaApi(user, board, { title: "Alt B" });
  assert.ok(first.ok && second.ok);
  assert.equal(first.ok && first.value.position, 0);
  assert.equal(second.ok && second.value.position, 1);

  // Neue Karte MIT position=0 → muss vorn einsortiert werden.
  const created = await createCardViaApi(user, board, {
    title: "Neu vorn",
    position: 0,
  });
  assert.ok(created.ok, "Anlegen muss gelingen");

  const inColumn = await db
    .select({ id: cards.id, title: cards.title, position: cards.position })
    .from(cards)
    .where(eq(cards.statusId, col.id))
    .orderBy(asc(cards.position), asc(cards.id));
  assert.deepEqual(
    inColumn.map((c) => c.title),
    ["Neu vorn", "Alt A", "Alt B"],
    "position=0 beim Anlegen muss wie in der Spec vorn einsortieren",
  );
  // Lückenlose Neu-Nummerierung wie beim Drag&Drop.
  assert.deepEqual(inColumn.map((c) => c.position), [0, 1, 2]);

  // Gegenprobe: ohne position weiterhin ans Ende.
  const appended = await createCardViaApi(user, board, { title: "Ans Ende" });
  assert.ok(appended.ok);
  assert.equal(appended.ok && appended.value.position, 3);
});
