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
  canAccessProtocolArea,
  canManageProtocolArea,
  deriveProtocolSessionDiscovery,
  reconcileProtocolCardLinks,
  sortProtocolSuggestions,
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
  const [card] = await db.insert(cards).values({ boardId: board.id, statusId: status.id, title: "Sommerfest", applicant: "Fachschaft", token: `protocol-${suffix}`, position: 7 }).returning();

  await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.1" }]);
  const [linked] = await db.select().from(cards).where(eq(cards.id, card.id));
  assert.equal(linked.statusId, status.id, "Sitzungsverknüpfung darf den Status nicht ändern");
  assert.equal(linked.position, 7, "Sitzungsverknüpfung darf die Kartenposition nicht ändern");
  assert.equal(linked.decisionRef, "2026-08-14-TOP-5.1");

  await db.update(cards).set({ decisionRef: "Manueller Beschluss 7/26" }).where(eq(cards.id, card.id));
  const conflict = await reconcileProtocolCardLinks(area, session, [{ cardId: card.id, top: "5.2" }]);
  assert.equal(conflict.conflicts, 1);
  const [protectedCard] = await db.select().from(cards).where(eq(cards.id, card.id));
  assert.equal(protectedCard.decisionRef, "Manueller Beschluss 7/26");

  await reconcileProtocolCardLinks(area, session, []);
  const remaining = await db.select().from(protocolCardLinks).where(and(eq(protocolCardLinks.sessionId, session.id), eq(protocolCardLinks.cardId, card.id)));
  assert.equal(remaining.length, 0, "Entfernen des Blocks muss die Relation entfernen");
});
