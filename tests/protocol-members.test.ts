// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { protocolAreas, protocolAreaAccess, protocolAttendance, protocolMembers, protocolSessions, protocolTemplates, users } from "../lib/db/schema";
import { changeProtocolMembers, getProtocolMembers } from "../lib/protocol-members";
import { markdownTableCells, upsertMemberAttendance } from "../lib/protocol-markdown";

after(async () => { await pool.end(); });
const members = [
  { id: 1, name: "Anna", present: true, proxyMemberId: null },
  { id: 2, name: "Ben", present: false, proxyMemberId: 1 },
  { id: 3, name: "Clara", present: false, proxyMemberId: null },
];

test("Anwesenheitstabelle enthält alle Mitglieder, Ja/Nein und optionale Übertragungen", () => {
  const text = upsertMemberAttendance("# Sitzung\n\n## TOP 1 Start\nInhalt", members);
  assert.ok(text.includes("## Anwesenheit\n\n### Mitglieder"));
  assert.ok(text.includes("| Anna | Ja |  |\n| Ben | Nein | Anna |\n| Clara | Nein |  |"));
  assert.ok(text.endsWith("## TOP 1 Start\nInhalt"));
  assert.equal(upsertMemberAttendance(text, members), text);
  const reordered = upsertMemberAttendance(text, [members[2], members[0]]);
  assert.ok(reordered.indexOf("| Clara |") < reordered.indexOf("| Anna |"));
  assert.ok(!reordered.includes("| Ben |"));
  assert.equal((reordered.match(/^## Anwesenheit$/gm) ?? []).length, 1);
  assert.equal((reordered.match(/^### Mitglieder$/gm) ?? []).length, 1);
});

test("bestehende Abschnitte, Notizen, Gäste und unmarkierte Tabellen bleiben korrekt zugeordnet", () => {
  const text = "# Sitzung\n\n## Anwesenheit\nEinleitung\n\n### Mitglieder\nNotiz davor\n\n| Mitglied | Anwesend | übertragen auf |\n| --- | --- | --- |\n| Alt | Nein | |\n\nNotiz danach\n\n### Gäste\nGast\n\n## TOP 1\nInhalt";
  const next = upsertMemberAttendance(text, members);
  for (const note of ["Einleitung", "Notiz davor", "Notiz danach", "### Gäste\nGast", "## TOP 1\nInhalt"]) assert.ok(next.includes(note));
  assert.ok(!next.includes("| Alt |"));
  assert.equal((next.match(/\| Mitglied \|/g) ?? []).length, 1);
  assert.equal(upsertMemberAttendance(next, members), next);
});

test("leere Mitgliederlisten, fehlende Zeilenumbrüche und Markdown-Sonderzeichen sind sicher", () => {
  for (const source of ["", "# Sitzung", "## Anwesenheit", "## Anwesenheit\n\n### Mitglieder"]) {
    const text = upsertMemberAttendance(source, []);
    assert.equal(upsertMemberAttendance(text, []), text);
    assert.ok(text.includes("| Mitglied | Anwesend | übertragen auf |"));
  }
  const weird = { ...members[0], name: "A | B <script> [x] \\ & *Test*" };
  const text = upsertMemberAttendance("", [weird]);
  const row = text.split("\n").find(line => line.startsWith("| A"))!;
  assert.deepEqual(markdownTableCells(row), [weird.name, "Ja", ""]);
  assert.ok(!text.includes("<script>"));
  const example = "```md\n## Anwesenheit\n### Mitglieder\n```\n\n## TOP 1\n";
  const withExample = upsertMemberAttendance(example, members);
  assert.ok(withExample.includes("```md\n## Anwesenheit\n### Mitglieder\n```"));
  assert.ok(withExample.endsWith("## TOP 1\n"));
  const code = "```md\n<!-- gremio:attendance:members:start -->\nBeispiel\n<!-- gremio:attendance:members:end -->\n```";
  const withCode = upsertMemberAttendance(`## Anwesenheit\n### Mitglieder\n${code}\n`, members);
  assert.ok(withCode.includes(code));
  assert.equal(upsertMemberAttendance(withCode, members), withCode);
});

test("Mitglieder sind bereichsweit, Anwesenheit und Übertragungen sitzungsbezogen und berechtigt", async t => {
  try { if (!(await pool.query("select to_regclass('public.protocol_members') as name")).rows[0].name) return t.skip("Mitgliedermigration fehlt"); }
  catch { return t.skip("keine lokale Testdatenbank erreichbar"); }
  const suffix = `${process.pid}-${Date.now()}`;
  const [owner, shared, outsider] = await db.insert(users).values([
    { username: `members-owner-${suffix}` }, { username: `members-shared-${suffix}` }, { username: `members-outsider-${suffix}` },
  ]).returning();
  const [template] = await db.insert(protocolTemplates).values({ name: `Members ${suffix}`, markdown: "# Sitzung" }).returning();
  const [area, other] = await db.insert(protocolAreas).values(["One", "Two"].map(name => ({ name, ownerId: owner.id, templateId: template.id, ncUrl: "https://example.invalid", ncUsername: "test", ncPasswordEnc: "unused", rootPath: "/Protokolle" }))).returning();
  try {
    await db.insert(protocolAreaAccess).values({ areaId: area.id, userId: shared.id });
    const [first, second, foreign] = await db.insert(protocolSessions).values([
      { areaId: area.id, folderName: "First" }, { areaId: area.id, folderName: "Second" }, { areaId: other.id, folderName: "Foreign" },
    ]).returning();
    await assert.rejects(changeProtocolMembers(outsider, area.id, first.id, { type: "add", name: "No" }), /Kein Zugriff/);
    await assert.rejects(changeProtocolMembers(owner, area.id, foreign.id, { type: "add", name: "No" }), /Sitzung gehört nicht/);
    await changeProtocolMembers(owner, area.id, first.id, { type: "add", name: " Anna " });
    let rows = await changeProtocolMembers(shared, area.id, first.id, { type: "add", name: "Ben" });
    const [anna, ben] = rows;
    assert.deepEqual(rows.map(row => row.name), ["Anna", "Ben"]);
    assert.deepEqual(await getProtocolMembers(area.id, second.id), rows);
    await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "add", name: "anna" }), /bereits/);
    await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "add", name: "\n" }), /Ungültige/);
    const [external] = await changeProtocolMembers(owner, other.id, foreign.id, { type: "add", name: "External" });
    await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "attendance", memberId: anna.id, present: true, proxyMemberId: external.id }), /anderes Mitglied/);
    await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "attendance", memberId: anna.id, present: true, proxyMemberId: anna.id }), /anderes Mitglied/);
    await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "remove", memberId: external.id }), /Mitglied gehört nicht/);
    rows = await changeProtocolMembers(owner, area.id, first.id, { type: "attendance", memberId: ben.id, present: false, proxyMemberId: anna.id });
    rows = await changeProtocolMembers(shared, area.id, first.id, { type: "attendance", memberId: anna.id, present: true, proxyMemberId: null });
    assert.equal(rows[0].present, true); assert.equal(rows[1].proxyMemberId, anna.id);
    assert.equal((await getProtocolMembers(area.id, second.id))[0].present, false);
    assert.equal((await getProtocolMembers(area.id, second.id))[1].proxyMemberId, null);
    for (const ids of [[anna.id], [anna.id, anna.id], [anna.id, external.id]]) await assert.rejects(changeProtocolMembers(owner, area.id, first.id, { type: "reorder", ids }), /Mitgliederliste/);
    rows = await changeProtocolMembers(owner, area.id, first.id, { type: "reorder", ids: [ben.id, anna.id] });
    assert.deepEqual(rows.map(row => row.id), [ben.id, anna.id]);
    assert.deepEqual((await getProtocolMembers(area.id, second.id)).map(row => row.id), [ben.id, anna.id]);
    rows = await changeProtocolMembers(owner, area.id, first.id, { type: "remove", memberId: anna.id });
    assert.deepEqual(rows, [{ ...ben, proxyMemberId: null }]);
    assert.equal((await db.select().from(protocolAttendance).where(eq(protocolAttendance.memberId, anna.id))).length, 0);
    await db.delete(protocolSessions).where(eq(protocolSessions.id, first.id));
    assert.equal((await db.select().from(protocolAttendance).where(eq(protocolAttendance.sessionId, first.id))).length, 0);
    assert.equal((await db.select().from(protocolMembers).where(eq(protocolMembers.areaId, area.id))).length, 1);
  } finally {
    await db.delete(protocolAreas).where(inArray(protocolAreas.id, [area.id, other.id]));
    await db.delete(protocolTemplates).where(eq(protocolTemplates.id, template.id));
    await db.delete(users).where(inArray(users.id, [owner.id, shared.id, outsider.id]));
  }
});
