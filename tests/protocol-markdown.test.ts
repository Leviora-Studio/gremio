// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFinanceLinks,
  formatFinanceBlock,
  getMarkdownHeadings,
  hasManagedAgenda,
  mayReplaceDecisionRef,
  renderDecisionRef,
  renderProtocolTemplate,
  renderSessionName,
  upsertAgenda,
  validateFilePattern,
  validateProtocolTemplate,
  syncProtocolAttendance,
  isAttendanceSectionIncluded,
  setAttendanceSectionIncluded,
} from "../lib/protocol-markdown";

test("Anwesenheitsabschnitte lassen sich unabhängig entfernen und mit aktuellen Daten wieder hinzufügen", () => {
  const members = [{ id: 1, name: "Anna", present: true, proxyMemberId: null }];
  const guests = [{ name: "Ben", affiliation: "Team", concern: "Frage" }];
  const original = "# Sitzung\n\n## Anwesenheit\nEinleitung\n\n### Mitglieder\nEigene Mitgliedernotiz\n\n### Gäste\nEigene Gästenotiz\n\n## TOP 1\nInhalt";
  for (const section of ["members", "guests"] as const) {
    const includedTitle = section === "members" ? "Gäste" : "Mitglieder";
    const removedTitle = section === "members" ? "Mitglieder" : "Gäste";
    const initial = syncProtocolAttendance(original, members, guests);
    const removed = syncProtocolAttendance(setAttendanceSectionIncluded(initial, section, false), members, guests);
    assert.equal(isAttendanceSectionIncluded(removed, section), false);
    assert.ok(!getMarkdownHeadings(removed).some(h => h.title === removedTitle));
    assert.ok(getMarkdownHeadings(removed).some(h => h.title === includedTitle));
    assert.ok(removed.includes("Einleitung"));
    assert.ok(removed.endsWith("## TOP 1\nInhalt"));
    // Same normalizer runs on server save, editor reload, and person mutations.
    assert.equal(syncProtocolAttendance(removed, members, guests), removed);
    assert.equal(setAttendanceSectionIncluded(removed, section, false), removed);
    const restored = syncProtocolAttendance(setAttendanceSectionIncluded(removed, section, true), [{ ...members[0], name: "Anna Neu" }], guests);
    assert.equal(isAttendanceSectionIncluded(restored, section), true);
    assert.deepEqual(getMarkdownHeadings(restored).filter(h => ["Anwesenheit", "Mitglieder", "Gäste"].includes(h.title)).map(h => [h.level, h.title]), [[2, "Anwesenheit"], [3, "Mitglieder"], [3, "Gäste"]]);
    assert.ok(restored.includes("| Anna Neu | Ja |"));
    assert.ok(restored.includes("| Ben | Team | Frage |"));
    assert.equal(syncProtocolAttendance(restored, members, guests), syncProtocolAttendance(syncProtocolAttendance(restored, members, guests), members, guests));
  }
});

test("beide entfernten Abschnitte lassen keine leere Anwesenheit zurück und bewahren fremde Inhalte", () => {
  for (const note of ["", "Notiz\n\n### Weitere Personen\nText\n\n"]) {
    let text = syncProtocolAttendance(`# Sitzung\n\n## Anwesenheit\n${note}## TOP 1\nUnverändert`, [], []);
    text = setAttendanceSectionIncluded(setAttendanceSectionIncluded(text, "members", false), "guests", false);
    const synced = syncProtocolAttendance(text, [], []);
    assert.equal(synced, text);
    assert.equal(getMarkdownHeadings(text).some(h => h.title === "Anwesenheit"), !!note);
    assert.ok(text.includes(note));
    assert.ok(text.endsWith("## TOP 1\nUnverändert"));
    const guestOnly = syncProtocolAttendance(setAttendanceSectionIncluded(text, "guests", true), [], []);
    assert.ok(!getMarkdownHeadings(guestOnly).some(h => h.title === "Mitglieder"));
    assert.ok(getMarkdownHeadings(guestOnly).some(h => h.title === "Gäste"));
    assert.equal(syncProtocolAttendance(guestOnly, [], []), guestOnly);
  }
});

test("Entfernungsmarker und Überschriften in Codebeispielen steuern keine Anwesenheit", () => {
  const code = "```md\n<!-- gremio:attendance:members:hidden -->\n## Anwesenheit\n### Mitglieder\nBeispiel\n```\n";
  assert.equal(isAttendanceSectionIncluded(code, "members"), true);
  const text = syncProtocolAttendance(code, [], []);
  const removed = syncProtocolAttendance(setAttendanceSectionIncluded(text, "members", false), [], []);
  assert.ok(removed.includes(code));
  const restored = syncProtocolAttendance(setAttendanceSectionIncluded(removed, "members", true), [], []);
  assert.ok(restored.includes(code));
  assert.equal(isAttendanceSectionIncluded(restored, "members"), true);
});

test("Sitzungs- und Dateimuster lösen nur dokumentierte Platzhalter auf", () => {
  const folder = renderSessionName("{YYYY}-{MM}-{DD}-{area}", "2026-08-14", "Großer StuRa");
  assert.equal(folder, "2026-08-14-Großer StuRa");
  assert.equal(validateFilePattern("{session}-Protokoll.md", "2026-08-14", "Großer StuRa", folder), "2026-08-14-Großer StuRa-Protokoll.md");
  assert.throws(() => renderSessionName("../{date}", "2026-08-14", "Gremium"), /Pfadtrenner/);
  assert.throws(() => validateFilePattern("Protokoll.txt", "2026-08-14", "Gremium", folder), /\.md/);
  assert.throws(() => renderSessionName("{unknown}", "2026-08-14", "Gremium"), /Unbekannter Platzhalter/);
  assert.throws(() => renderSessionName("{date}", "2026-02-31", "Gremium"), /ungültig/);
});

test("Protokollvorlagen erhalten unbekannte Variablen nicht stillschweigend", () => {
  validateProtocolTemplate("# {{session.date_de}} — {{protocol_area.name}}");
  assert.throws(() => validateProtocolTemplate("{{session.secret}}"), /Unbekannte Vorlagenvariable/);
  assert.equal(
    renderProtocolTemplate("# {{session.folder_name}}", {
      "session.date": "2026-08-14",
      "session.date_de": "14.08.2026",
      "session.folder_name": "2026-08-14",
      "protocol_area.name": "Gremium",
      created_at: "2026-08-14T10:00:00.000Z",
    }),
    "# 2026-08-14",
  );
});

function agendaList(markdown: string): string {
  return markdown.split("<!-- gremio:agenda:start -->")[1].split("<!-- gremio:agenda:end -->")[0];
}

test("Tagesordnung wird einmalig als H2 angelegt und enthält ausschließlich TOP-Überschriften", () => {
  const markdown = "# Sitzung\n\n## Anwesenheit\n\n## TOP 1 Begrüßung\n\n### Details\n\n### TOP 2.1 Finanzantrag\n\n## Sonstiges\n";
  const once = upsertAgenda(markdown);
  assert.equal(upsertAgenda(once), once);
  assert.equal((once.match(/^## Tagesordnung$/gm) ?? []).length, 1);
  assert.equal((once.match(/gremio:agenda:start/g) ?? []).length, 1);
  assert.equal(hasManagedAgenda(once), true);
  assert.equal(agendaList(once), "\n- [TOP 1 Begrüßung](#top-1-begrüßung)\n- [TOP 2.1 Finanzantrag](#top-21-finanzantrag)\n");
  assert.ok(once.endsWith(markdown.slice(markdown.indexOf("## Anwesenheit"))));
});

test("vorhandene Tagesordnung mit Liste wird genutzt, eigene Notizen und Folgeabschnitte bleiben", () => {
  const before = "# Sitzung\n\n## Anwesenheit\nA und B\n\n";
  const after = "### TOP 1 Eröffnung\nEigener Inhalt\n\n## TOP 2 Finanzen\nWeiterer Inhalt\n";
  const markdown = `${before}## Tagesordnung\n\nBitte die Reihenfolge prüfen.\n\n- Alter Punkt\n- Zweiter alter Punkt\n\nNotiz zur Tagesordnung.\n\n${after}`;
  const result = upsertAgenda(markdown);
  assert.ok(result.startsWith(before));
  assert.ok(result.endsWith(after));
  assert.equal((result.match(/^## Tagesordnung$/gm) ?? []).length, 1);
  assert.match(result, /Bitte die Reihenfolge prüfen\./);
  assert.match(result, /Notiz zur Tagesordnung\./);
  assert.doesNotMatch(result, /Alter Punkt|Zweiter alter Punkt/);
  assert.match(agendaList(result), /TOP 1 Eröffnung/);
  assert.match(agendaList(result), /TOP 2 Finanzen/);
  assert.equal(upsertAgenda(result), result);
});

test("Änderungen an TOPs ersetzen die verwaltete Liste ohne Duplikate", () => {
  const once = upsertAgenda("## Tagesordnung\n\n## TOP 1 Alt\n\n## TOP 2 Entfernen\n");
  const updated = upsertAgenda(once.replace("## TOP 1 Alt", "## TOP 1 Neu").replace("## TOP 2 Entfernen", "## Kein TOP mehr"));
  assert.equal((updated.match(/gremio:agenda:start/g) ?? []).length, 1);
  assert.equal(agendaList(updated), "\n- [TOP 1 Neu](#top-1-neu)\n");
});

test("alte verwaltete Inhaltsverzeichnisse werden in eine einzige Tagesordnung überführt", () => {
  const legacy = "<!-- gremio:toc:start -->\n## Inhaltsverzeichnis\n\n- [Anwesenheit](#anwesenheit)\n<!-- gremio:toc:end -->";
  for (const existingSection of ["", "\n\n## Tagesordnung\n"]) {
    const result = upsertAgenda(`# Sitzung\n\n${legacy}${existingSection}\n\n## Anwesenheit\n\n## TOP 1 Start\n`);
    assert.equal((result.match(/^## Tagesordnung$/gm) ?? []).length, 1);
    assert.doesNotMatch(result, /gremio:toc|Inhaltsverzeichnis/);
    assert.equal(agendaList(result), "\n- [TOP 1 Start](#top-1-start)\n");
    assert.equal(upsertAgenda(result), result);
  }
});

test("TOP-Anker passen zur Vorschau, auch bei Umlauten, doppelten Überschriften und Codeblöcken", () => {
  const markdown = "# TOP 1 Ämter & Übergabe\n\n## Tagesordnung\n\n```md\n## TOP 9 Kein echter TOP\n```\n\n~~~\n## TOP 8 Auch nur Code\n~~~\n\n## TOP 1 Ämter & Übergabe ##\n\n## TOPIC kein Tagesordnungspunkt\n";
  const result = upsertAgenda(markdown);
  const expected = getMarkdownHeadings(result).filter((heading) => /^TOP\b/i.test(heading.title));
  assert.deepEqual(expected.map((heading) => heading.slug), ["top-1-ämter-übergabe", "top-1-ämter-übergabe-1"]);
  for (const heading of expected) assert.ok(agendaList(result).includes(`](#${heading.slug})`));
  assert.doesNotMatch(agendaList(result), /TOP 9|TOP 8|TOPIC/);
});

test("leere Tagesordnung und Überschriften ohne abschließenden Zeilenumbruch bleiben wiederholbar", () => {
  for (const markdown of ["", "# Sitzung", "## Tagesordnung", "## Tagesordnung\n\n## Anwesenheit\n"]) {
    const result = upsertAgenda(markdown);
    assert.equal((result.match(/^## Tagesordnung$/gm) ?? []).length, 1);
    assert.match(agendaList(result), /Noch keine TOP-Überschriften/);
    assert.equal(upsertAgenda(result), result);
  }
});

test("Listen in Codebeispielen bleiben erhalten und unmarkierte TOP-Listen werden übernommen", () => {
  const example = "```md\n- Beispiel, keine Tagesordnung\n## TOP 99 Nur ein Beispiel\n```";
  const markdown = `# Sitzung\n\n## Tagesordnung\n\n${example}\n\n- [TOP 1 Alt](#top-1-alt)\n\n## TOP 1 Neu\n`;
  const result = upsertAgenda(markdown);
  assert.ok(result.includes(example));
  assert.doesNotMatch(result, /\[TOP 1 Alt\]/);
  assert.equal(agendaList(result), "\n- [TOP 1 Neu](#top-1-neu)\n");
  const withoutMarkers = result.replace(/<!-- gremio:agenda:(?:start|end) -->\n?/g, "");
  const adopted = upsertAgenda(withoutMarkers);
  assert.equal((adopted.match(/\[TOP 1 Neu\]/g) ?? []).length, 1);
  assert.ok(adopted.includes(example));
});

test("Finanzblöcke tragen eine stabile Karten-ID und eine TOP-Nummer", () => {
  const block = formatFinanceBlock(
    { id: 42, number: "2026_GSR_014", title: "Sommerfest", applicant: "Fachschaft", amount: 85000, fields: [{ key: "requested_amount", label: "Beantragter Betrag", value: "850,00 €" }] },
    "5.1",
    "https://gremio.example/intern/card/42",
  );
  assert.deepEqual(extractFinanceLinks(block), [{ cardId: 42, top: "5.1" }]);
  assert.match(block, /850,00\s€/);
  assert.match(block, /\/intern\/card\/42/);
  assert.deepEqual(
    extractFinanceLinks(block.replace(/<!-- gremio:finance:[^>]+-->\n?/g, "")),
    [{ cardId: 42, top: "5.1" }],
    "der normale HTTPS-Kartenlink ist auch ohne HTML-Kommentare stabil",
  );
});

test("Beschlussreferenz wird aus Sitzung und TOP erzeugt", () => {
  assert.equal(renderDecisionRef("{YYYY}-{MM}-{DD}-{session}-TOP-{top}", "S-14", "2026-08-14", "5.1"), "2026-08-14-S-14-TOP-5.1");
  assert.throws(
    () => renderDecisionRef("{session}-{unknown}", "S-14", "2026-08-14", "5.1"),
    /Unbekannter Platzhalter/,
  );
  assert.equal(mayReplaceDecisionRef(null, []), true);
  assert.equal(mayReplaceDecisionRef("2026-08-14-TOP-5.1", ["2026-08-14-TOP-5.1"]), true);
  assert.equal(mayReplaceDecisionRef("Manueller Beschluss 7/26", ["2026-08-14-TOP-5.1"]), false);
});


test("generated session and file names obey the same path and byte limits as writes", () => {
  for (const name of ["Sitzung\nNeu", "Sitzung\tNeu", "a__PATH_SEPARATOR_POSIX__b", "a__PATH_SEPARATOR_WINDOWS__b", "界".repeat(86)]) {
    assert.throws(() => renderSessionName(name, "2026-09-04", "Area"));
    assert.throws(() => validateFilePattern(`${name}.md`, "2026-09-04", "Area", "Session"));
  }
});
