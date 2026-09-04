// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { protocolAreas, protocolGuests, protocolSessions, protocolTemplates, users } from "../lib/db/schema";
import { changeProtocolGuests, getProtocolGuests } from "../lib/protocol-guests";
import { getMarkdownHeadings, markdownTableCells, syncProtocolAttendance, upsertGuestAttendance, upsertMemberAttendance } from "../lib/protocol-markdown";

after(async () => { await pool.end(); });
const members = [{ id: 1, name: "Anna", present: true, proxyMemberId: null }];
const guests = [{ name: "Ben", affiliation: "Fachschaft", concern: "Raumnutzung" }, { name: "Clara", affiliation: "", concern: "" }];

test("Gäste stehen direkt unter Mitgliedern mit Name, Zugehörigkeit und Anliegen", () => {
  const source = "# Sitzung\n\n## Anwesenheit\n\n### Mitglieder\nNotiz\n\n### Sonstige\nErhalten\n\n## TOP 1\nInhalt\n";
  const text = syncProtocolAttendance(source, members, guests);
  assert.ok(text.indexOf("### Mitglieder") < text.indexOf("### Gäste"));
  assert.ok(text.indexOf("### Gäste") < text.indexOf("### Sonstige"));
  assert.ok(text.includes("| Name | Zugehörigkeit | Anliegen |\n| --- | --- | --- |\n| Ben | Fachschaft | Raumnutzung |\n| Clara |  |  |"));
  assert.ok(text.includes("Notiz")); assert.ok(text.includes("### Sonstige\nErhalten")); assert.ok(text.endsWith("## TOP 1\nInhalt\n"));
  assert.equal(syncProtocolAttendance(text, members, guests), text);
  const empty = syncProtocolAttendance(text, members, []);
  assert.ok(!empty.includes("| Ben |")); assert.ok(empty.includes("| Anna | Ja |"));
});

test("vorhandene Gästeabschnitte und Tabellen werden wiederverwendet und hinter Mitglieder einsortiert", () => {
  const source = "## Anwesenheit\n\n### Gäste\nNotiz davor\n\n| Name | Zugehörigkeit | Anliegen |\n| --- | --- | --- |\n| Alt | Alt | Alt |\n\nNotiz danach\n\n### Mitglieder\nMitgliedernotiz\n\n## TOP 1\nInhalt";
  const text = upsertGuestAttendance(source, guests);
  assert.equal((text.match(/^### Gäste$/gm) ?? []).length, 1);
  assert.ok(text.indexOf("### Gäste") > text.indexOf("### Mitglieder"));
  for (const note of ["Notiz davor", "Notiz danach", "Mitgliedernotiz", "## TOP 1\nInhalt"]) assert.ok(text.includes(note));
  assert.ok(!text.includes("| Alt |"));
  assert.equal(upsertGuestAttendance(text, guests), text);
});

test("leere Protokolle und Sitzung nur mit Gästen erzeugen wiederholbare Tabellen", () => {
  for (const source of ["", "# Sitzung", "## Anwesenheit", "## Anwesenheit\n### Mitglieder", "## Anwesenheit\n### Mitglieder\n### Gäste"]) {
    const text = syncProtocolAttendance(source, [], guests);
    assert.ok(text.includes("| Mitglied | Anwesend | übertragen auf |"));
    assert.ok(text.includes("### Gäste"));
    assert.equal(syncProtocolAttendance(text, [], guests), text);
  }
});

test("beide Tabellen stehen auch bei leeren Listen unter einer gemeinsamen H2 Anwesenheit", () => {
  for (const source of ["", "# Sitzung", "# Sitzung\n", "# Sitzung\n\n## Anwesenheit\n\n## TOP 1\nInhalt"]) {
    for (const rows of [[], members]) {
      const text = syncProtocolAttendance(source, rows, []);
      const headings = getMarkdownHeadings(text);
      const attendanceIndex = headings.findIndex(h => h.title === "Anwesenheit");
      assert.deepEqual(headings.slice(attendanceIndex, attendanceIndex + 3).map(h => [h.level, h.title]), [
        [2, "Anwesenheit"], [3, "Mitglieder"], [3, "Gäste"],
      ]);
      assert.equal(headings.filter(h => h.title === "Anwesenheit").length, 1);
      if (source.startsWith("# Sitzung")) assert.equal(headings[0].title, "Sitzung");
      assert.ok(text.includes("| Mitglied | Anwesend | übertragen auf |"));
      assert.ok(text.includes("| Name | Zugehörigkeit | Anliegen |"));
      assert.equal(syncProtocolAttendance(text, rows, []), text);
      if (source.includes("## TOP 1")) assert.ok(text.endsWith("## TOP 1\nInhalt"));
    }
  }
});

test("Gästetabellen schützen Markdown-Sonderzeichen, Codebeispiele und Mitgliedertabellen", () => {
  const guest = { name: "A | B", affiliation: "<Org> & [Team]", concern: "Erste Zeile\nZweite *Zeile*" };
  const code = "```md\n<!-- gremio:attendance:guests:start -->\nBeispiel\n<!-- gremio:attendance:guests:end -->\n```";
  const before = upsertMemberAttendance(`## Anwesenheit\n### Mitglieder\n### Gäste\n${code}\n`, members);
  const text = upsertGuestAttendance(before, [guest]);
  const row = text.split("\n").find(line => line.startsWith("| A \\| B"))!;
  assert.deepEqual(markdownTableCells(row), [guest.name, guest.affiliation, "Erste Zeile Zweite *Zeile*"]);
  assert.ok(text.includes(code)); assert.ok(text.includes("| Anna | Ja |  |"));
  assert.equal(upsertGuestAttendance(text, [guest]), text);
});

test("Gäste-CRUD ist sitzungsbezogen, validiert und gegen fremde Bereiche geschützt", async t => {
  try { if (!(await pool.query("select to_regclass('public.protocol_guests') as name")).rows[0].name) return t.skip("Gästemigration fehlt"); }
  catch { return t.skip("keine lokale Testdatenbank erreichbar"); }
  const suffix = `${process.pid}-${Date.now()}`;
  const [owner, outsider] = await db.insert(users).values([{ username: `guest-owner-${suffix}` }, { username: `guest-outsider-${suffix}` }]).returning();
  const [template] = await db.insert(protocolTemplates).values({ name: `Guests ${suffix}`, markdown: "# Sitzung" }).returning();
  const [area, other] = await db.insert(protocolAreas).values(["One", "Two"].map(name => ({ name, ownerId: owner.id, templateId: template.id, ncUrl: "https://example.invalid", ncUsername: "test", ncPasswordEnc: "unused", rootPath: "/Protokolle" }))).returning();
  try {
    const [first, second, foreign] = await db.insert(protocolSessions).values([{ areaId: area.id, folderName: "First" }, { areaId: area.id, folderName: "Second" }, { areaId: other.id, folderName: "Foreign" }]).returning();
    const add = { type: "add" as const, name: " Ben ", affiliation: "", concern: "" };
    await assert.rejects(changeProtocolGuests(outsider, area.id, first.id, add), /Kein Zugriff/);
    await assert.rejects(changeProtocolGuests(owner, area.id, foreign.id, add), /Sitzung gehört nicht/);
    const [ben] = await changeProtocolGuests(owner, area.id, first.id, add);
    assert.equal(ben.name, "Ben"); assert.equal(ben.affiliation, "");
    assert.deepEqual(await getProtocolGuests(area.id, second.id), []);
    assert.deepEqual(await getProtocolGuests(other.id, first.id), []);
    const update = { type: "update" as const, guestId: ben.id, name: "Ben Neu", affiliation: "Team", concern: "Frage\nWeitere Frage" };
    await assert.rejects(changeProtocolGuests(owner, area.id, second.id, update), /Gast nicht/);
    const [updated] = await changeProtocolGuests(owner, area.id, first.id, update);
    assert.equal(updated.name, update.name); assert.equal(updated.concern, update.concern);
    for (const invalid of [{ ...add, name: " " }, { ...add, name: "X\0Y" }, { ...add, affiliation: "x".repeat(301) }, { ...add, concern: "x".repeat(1001) }]) await assert.rejects(changeProtocolGuests(owner, area.id, first.id, invalid), /Bitte einen Namen/);
    await assert.rejects(changeProtocolGuests(owner, area.id, second.id, { type: "remove", guestId: ben.id }), /Gast nicht/);
    assert.deepEqual(await changeProtocolGuests(owner, area.id, first.id, { type: "remove", guestId: ben.id }), []);
    await changeProtocolGuests(owner, area.id, first.id, add);
    await changeProtocolGuests(owner, area.id, second.id, add);
    await db.delete(protocolSessions).where(eq(protocolSessions.id, first.id));
    assert.equal((await db.select().from(protocolGuests).where(eq(protocolGuests.sessionId, first.id))).length, 0);
    assert.equal((await getProtocolGuests(area.id, second.id)).length, 1);
  } finally {
    await db.delete(protocolAreas).where(inArray(protocolAreas.id, [area.id, other.id]));
    await db.delete(protocolTemplates).where(eq(protocolTemplates.id, template.id));
    await db.delete(users).where(inArray(users.id, [owner.id, outsider.id]));
  }
});
