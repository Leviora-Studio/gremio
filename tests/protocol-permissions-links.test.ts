// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  boardStatuses,
  boards,
  cards,
  groups,
  protocolAreaAccess,
  protocolAreas,
  protocolCardLinks,
  protocolSessions,
  protocolTemplates,
  userGroups,
  users,
} from "../lib/db/schema";
import {
  assertProtocolDeletionBoardAccess,
  canAccessProtocolArea,
  canManageProtocolArea,
  cleanupDeletedProtocolResource,
  deriveProtocolFileMetadata,
  deriveProtocolSessionDiscovery,
  reconcileProtocolCardLinks,
  sortProtocolSuggestions,
  syncProtocolSessionFile,
} from "../lib/protocols";
import type { WebDavEntry } from "../lib/nextcloud";

let available = false;
let cleanup: (() => Promise<void>) | undefined;

before(async () => {
  try {
    const result = await pool.query("select to_regclass('public.protocol_areas') as table_name");
    available = !!result.rows[0]?.table_name;
  } catch {
    available = false;
  }
});

after(async () => {
  if (cleanup) await cleanup();
  await pool.end().catch(() => {});
});

function webDavEntry(
  values: Partial<WebDavEntry> & Pick<WebDavEntry, "name" | "path" | "type">,
): WebDavEntry {
  return {
    etag: null,
    fileId: null,
    mime: null,
    size: 0,
    lastModified: null,
    ...values,
  };
}

test("externe Sitzungsordner werden erkannt und Umbenennungen über Datei-IDs verfolgt", () => {
  const area = { id: 8, name: "Großer StuRa", filePattern: "Protokoll.md" };
  const syncedAt = new Date("2026-08-14T12:00:00.000Z");
  const external = deriveProtocolSessionDiscovery(
    area,
    [],
    webDavEntry({
      path: "/Protokolle/2026-08-14",
      name: "2026-08-14",
      type: "directory",
      fileId: "folder-17",
    }),
    [],
    syncedAt,
  );
  assert.equal(external.existingId, null);
  assert.equal(external.values.folderName, "2026-08-14");
  assert.equal(external.values.sessionDate, "2026-08-14");
  assert.equal(external.values.protocolPath, null);

  const renamed = deriveProtocolSessionDiscovery(
    area,
    [
      {
        id: 44,
        folderName: "2026-08-14",
        folderFileId: "folder-17",
        protocolFileId: "file-23",
      },
    ],
    webDavEntry({
      path: "/Protokolle/Sitzung-umbenannt",
      name: "Sitzung-umbenannt",
      type: "directory",
      fileId: "folder-17",
    }),
    [
      webDavEntry({
        path: "/Protokolle/Sitzung-umbenannt/Notizen.md",
        name: "Notizen.md",
        type: "file",
        fileId: "file-23",
        etag: '"etag-neu"',
      }),
    ],
    syncedAt,
  );
  assert.equal(renamed.existingId, 44);
  assert.equal(renamed.values.folderName, "Sitzung-umbenannt");
  assert.equal(renamed.values.protocolPath, "/Protokolle/Sitzung-umbenannt/Notizen.md");
  assert.equal(renamed.values.protocolEtag, '"etag-neu"');
});

test("Sitzungsseite erkennt extern angelegte Protokolle ohne vorherigen Übersichtsabgleich", () => {
  const area = { name: "Großer StuRa", filePattern: "Protokoll-{date}.md" };
  const session = { folderName: "2026-08-14", sessionDate: null, protocolPath: null, protocolFileId: null };
  const file = webDavEntry({ name: "Protokoll-2026-08-14.md", path: "/Protokolle/2026-08-14/Protokoll-2026-08-14.md", type: "file", fileId: "23", etag: "new", lastModified: "2026-08-14T12:00:00Z" });
  assert.equal(deriveProtocolFileMetadata(area, session, []).protocolPath, null);
  const metadata = deriveProtocolFileMetadata(area, session, [file]);
  assert.equal(metadata.protocolPath, file.path);
  assert.equal(metadata.protocolFileId, "23");
  assert.equal(metadata.protocolEtag, "new");
  assert.equal(metadata.protocolLastModified?.toISOString(), "2026-08-14T12:00:00.000Z");
  assert.equal(deriveProtocolFileMetadata(area, { ...session, folderName: "Sondersitzung", sessionDate: "2026-08-14" }, [file]).protocolPath, file.path);
  assert.equal(deriveProtocolFileMetadata(area, session, [{ ...file, type: "directory" }]).protocolPath, null);
  assert.equal(deriveProtocolFileMetadata(area, session, [{ ...file, name: "Notizen.md", path: "/Protokolle/2026-08-14/Notizen.md" }]).protocolPath, null);
});

test("direkter Sitzungsabgleich verfolgt bekannte Dateien und entfernt veraltete Dateimetadaten", () => {
  const area = { name: "Großer StuRa", filePattern: "Protokoll.md" };
  const session = { folderName: "2026-08-14", sessionDate: "2026-08-14", protocolPath: "/Protokolle/2026-08-14/Protokoll.md", protocolFileId: "23" };
  const renamed = webDavEntry({ name: "Umbenannt.md", path: "/Protokolle/2026-08-14/Umbenannt.md", type: "file", fileId: "23" });
  assert.equal(deriveProtocolFileMetadata(area, session, [renamed]).protocolPath, renamed.path);
  assert.equal(deriveProtocolFileMetadata(area, { ...session, protocolFileId: null, protocolPath: renamed.path }, [{ ...renamed, fileId: null }]).protocolPath, renamed.path);
  assert.deepEqual(deriveProtocolFileMetadata(area, session, []), {
    protocolPath: null, protocolFileId: null, protocolEtag: null, protocolLastModified: null,
  });
});

test("Finanzvorschläge sortieren nicht zugeordnete Anträge zuerst", () => {
  const sorted = sortProtocolSuggestions([
    { id: 1, number: "A-1", title: "Eins", applicant: "A", amount: 100, priority: null, assignedSession: "2026-08-01" },
    { id: 2, number: "A-2", title: "Zwei", applicant: "B", amount: 200, priority: "Hoch", assignedSession: null },
    { id: 3, number: "A-3", title: "Drei", applicant: "C", amount: null, priority: null, assignedSession: "2026-08-02" },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), [2, 1, 3]);
});

test("Protokollbereich prüft Eigentum, Admin sowie Nutzer- und Gruppenfreigaben", async (t) => {
  if (!available) return t.skip("keine migrierte Datenbank erreichbar");
  const suffix = `${process.pid}-${Date.now()}`;
  const createdUsers = await db.insert(users).values([
    { username: `protocol-owner-${suffix}` },
    { username: `protocol-direct-${suffix}` },
    { username: `protocol-group-${suffix}` },
    { username: `protocol-outside-${suffix}` },
    { username: `protocol-admin-${suffix}`, role: "admin" },
  ]).returning();
  const [owner, direct, grouped, outside, admin] = createdUsers;
  const [group] = await db.insert(groups).values({ name: `Protocol group ${suffix}` }).returning();
  await db.insert(userGroups).values({ userId: grouped.id, groupId: group.id });
  const [template] = await db.insert(protocolTemplates).values({ name: `Protocol template ${suffix}`, markdown: "# Test" }).returning();
  const [board] = await db.insert(boards).values({ name: `Protocol board ${suffix}`, ownerId: owner.id }).returning();
  const [status] = await db.insert(boardStatuses).values({ boardId: board.id, name: "Geplant", position: 0 }).returning();
  const [area] = await db.insert(protocolAreas).values({
    name: `Protocol area ${suffix}`,
    ownerId: owner.id,
    ncUrl: "https://cloud.example.test/remote.php/dav/files/test",
    ncUsername: "test",
    ncPasswordEnc: "encrypted-test-value",
    rootPath: "/Protokolle",
    templateId: template.id,
    boardId: board.id,
    sourceStatusId: status.id,
  }).returning();
  await db.insert(protocolAreaAccess).values([
    { areaId: area.id, userId: direct.id },
    { areaId: area.id, groupId: group.id },
  ]);
  cleanup = async () => {
    await db.delete(protocolAreas).where(eq(protocolAreas.id, area.id));
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(protocolTemplates).where(eq(protocolTemplates.id, template.id));
    await db.delete(groups).where(eq(groups.id, group.id));
    await db.delete(users).where(eq(users.username, owner.username));
    await db.delete(users).where(eq(users.username, direct.username));
    await db.delete(users).where(eq(users.username, grouped.username));
    await db.delete(users).where(eq(users.username, outside.username));
    await db.delete(users).where(eq(users.username, admin.username));
  };

  assert.equal(await canAccessProtocolArea(owner, area), true);
  assert.equal(await canAccessProtocolArea(direct, area), true);
  assert.equal(await canAccessProtocolArea(grouped, area), true);
  assert.equal(await canAccessProtocolArea(outside, area), false);
  assert.equal(await canAccessProtocolArea(admin, area), true);
  assert.equal(canManageProtocolArea(owner, area), true);
  assert.equal(canManageProtocolArea(direct, area), false);
  assert.equal(canManageProtocolArea(admin, area), true);

  const [session] = await db.insert(protocolSessions).values({ areaId: area.id, folderName: "2026-08-14", sessionDate: "2026-08-14" }).returning();
  // Direkter Seitenaufruf: eine bisher unbekannte Cloud-Datei registrieren,
  // sodass auch nachfolgende Lade-/Speicheraktionen sie ohne Übersicht finden.
  const externalFile = webDavEntry({ name: "Protokoll.md", path: "/Protokolle/2026-08-14/Protokoll.md", type: "file", fileId: "23", etag: "external" });
  const recognized = await syncProtocolSessionFile({ ...area, filePattern: "Protokoll.md" }, session, [externalFile]);
  assert.equal(recognized.protocolPath, externalFile.path);
  assert.equal((await db.select().from(protocolSessions).where(eq(protocolSessions.id, session.id)))[0].protocolFileId, "23");
  const missing = await syncProtocolSessionFile(area, recognized, []);
  assert.equal(missing.protocolPath, null);
  await assert.rejects(syncProtocolSessionFile({ ...area, id: -1 }, session, [externalFile]), /Sitzung nicht mehr vorhanden/);
  assert.equal((await db.select().from(protocolSessions).where(eq(protocolSessions.id, session.id)))[0].protocolPath, null);
  const [card] = await db.insert(cards).values({ boardId: board.id, statusId: status.id, title: "Sommerfest", applicant: "Fachschaft", token: `protocol-${suffix}`, position: 7 }).returning();

  await db.update(cards).set({ decisionRef: "Vorher manuell" }).where(eq(cards.id, card.id));
  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.1" }]);
  const [linked] = await db.select().from(cards).where(eq(cards.id, card.id));
  assert.equal(linked.statusId, status.id, "Sitzungsverknüpfung darf den Status nicht ändern");
  assert.equal(linked.position, 7, "Sitzungsverknüpfung darf die Kartenposition nicht ändern");
  assert.equal(linked.decisionRef, "2026-08-14-TOP-5.1");

  // Hold a concurrent manual edit uncommitted until reconciliation waits.
  const editor = await pool.connect();
  let concurrent: ReturnType<typeof reconcileProtocolCardLinks> | undefined;
  try {
    await editor.query("BEGIN");
    const { rows: [backend] } = await editor.query("select pg_backend_pid() as pid");
    await editor.query("update cards set decision_ref = $1 where id = $2", ["Concurrent manual reference", card.id]);
    concurrent = reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.1" }]);
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await pool.query("select 1 from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))", [backend.pid]);
      if (result.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "reconciliation must wait for the card lock");
    await editor.query("COMMIT");
    assert.equal((await concurrent).conflicts, 1);
    assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "Concurrent manual reference");
  } finally {
    await editor.query("ROLLBACK");
    editor.release();
    await concurrent;
  }

  await db.update(cards).set({ decisionRef: "Manueller Beschluss 7/26" }).where(eq(cards.id, card.id));
  const conflict = await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.1" }]);
  assert.equal(conflict.conflicts, 1);
  const [protectedCard] = await db.select().from(cards).where(eq(cards.id, card.id));
  assert.equal(protectedCard.decisionRef, "Manueller Beschluss 7/26");

  const changedTop = await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }]);
  assert.equal(changedTop.conflicts, 0);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "2026-08-14-TOP-5.2");
  assert.equal((await db.select().from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id)))[0].decisionRefConflict, false);

  await db.update(cards).set({ decisionRef: "Nachträglich manuell" }).where(eq(cards.id, card.id));
  await assert.rejects(reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }], [-1]), /Ungültige neu eingeplante/);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "Nachträglich manuell");
  // Removing and reinserting the same TOP before saving must still reset its reference.
  const replanned = await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }], [card.id]);
  assert.equal(replanned.conflicts, 0);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "2026-08-14-TOP-5.2");

  await db.update(cards).set({ decisionRef: "Manuell vor Entfernen" }).where(eq(cards.id, card.id));
  await reconcileProtocolCardLinks(area, session, []);
  const remaining = await db.select().from(protocolCardLinks).where(and(eq(protocolCardLinks.sessionId, session.id), eq(protocolCardLinks.cardId, card.id)));
  assert.equal(remaining.length, 0, "Entfernen des Blocks muss die Relation entfernen");
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "Manuell vor Entfernen");
  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }]);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, "2026-08-14-TOP-5.2", "Erneutes Einplanen nach gespeichertem Entfernen muss die Referenz setzen");
  await reconcileProtocolCardLinks(area, session, []);

  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }]);
  await reconcileProtocolCardLinks({ ...area, boardId: null }, session, []);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, null, "disconnecting the configured board must clear obsolete automatic references");
  assert.equal((await db.select().from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id))).length, 0);

  // Löschbereinigung: tatsächliche Boardrechte, n:m-Fallback, manuelle Werte,
  // Protokoll-Metadaten und komplette Sitzungsmetadaten bleiben konsistent.
  const [otherSession] = await db.insert(protocolSessions).values({ areaId: area.id, folderName: "2026-08-15", sessionDate: "2026-08-15" }).returning();
  await db.update(cards).set({ decisionRef: null }).where(eq(cards.id, card.id));
  await reconcileProtocolCardLinks(area, otherSession, [{ cardId: card.id, top: "3" }]);
  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "4" }]);
  await db.update(protocolCardLinks).set({ decisionRefConflict: true }).where(eq(protocolCardLinks.sessionId, otherSession.id));
  await reconcileProtocolCardLinks(area, session, []);
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, null, "a conflicting automatic reference is not a valid fallback");
  await db.update(protocolCardLinks).set({ decisionRefConflict: false }).where(eq(protocolCardLinks.sessionId, otherSession.id));
  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "4" }]);
  await assert.rejects(assertProtocolDeletionBoardAccess(direct, session), /Antragsboards/);
  await assert.rejects(cleanupDeletedProtocolResource(direct, session, "session"), /Antragsboards/);
  assert.equal((await db.select().from(protocolSessions).where(eq(protocolSessions.id, session.id))).length, 1);

  const [manualCard] = await db.insert(cards).values({ boardId: board.id, statusId: status.id, title: "Manueller Beschluss", applicant: "Fachschaft", token: `protocol-manual-${suffix}`, position: 9 }).returning();
  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "4" }, { cardId: manualCard.id, top: "5" }]);
  await db.update(cards).set({ decisionRef: "Manuell erhalten" }).where(eq(cards.id, manualCard.id));
  await db.update(protocolSessions).set({ protocolPath: "/Protokolle/2026-08-14/Protokoll.md", protocolFileId: "123", protocolEtag: "etag-123" }).where(eq(protocolSessions.id, session.id));

  await cleanupDeletedProtocolResource(owner, session, "protocol");
  const [afterProtocolDelete] = await db.select().from(protocolSessions).where(eq(protocolSessions.id, session.id));
  assert.equal(afterProtocolDelete.protocolPath, null);
  assert.equal(afterProtocolDelete.protocolFileId, null);
  assert.equal(afterProtocolDelete.protocolEtag, null);
  const [afterFallback] = await db.select().from(cards).where(eq(cards.id, card.id));
  assert.equal(afterFallback.decisionRef, "2026-08-15-TOP-3");
  assert.equal(afterFallback.statusId, status.id);
  assert.equal(afterFallback.position, 7);
  assert.equal((await db.select().from(cards).where(eq(cards.id, manualCard.id)))[0].decisionRef, "Manuell erhalten");
  assert.equal((await db.select().from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id))).length, 0);
  await cleanupDeletedProtocolResource(owner, session, "protocol"); // idempotenter Retry
  await cleanupDeletedProtocolResource(owner, session, "session");
  assert.equal((await db.select().from(protocolSessions).where(eq(protocolSessions.id, session.id))).length, 0);
  await cleanupDeletedProtocolResource(owner, otherSession, "session");
  assert.equal((await db.select().from(cards).where(eq(cards.id, card.id)))[0].decisionRef, null);
});
