// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProtocolFrontmatter, updateProtocolFrontmatter } from "../lib/protocol-frontmatter";
import { getMarkdownHeadings, syncProtocolAttendance, setAttendanceSectionIncluded, upsertAgenda } from "../lib/protocol-markdown";

test("session form writes YAML, preserves unknown fields/comments/body and reads aliases", () => {
  const source = '---\n# Keep this comment\ntags: [intern, protokoll]\nsitzungsleiter: Anna\nprotokollfuehrerin: Bea\nunterschriften: nein\n---\n\n# Sitzung\nUnverändert\n';
  const before = parseProtocolFrontmatter(source);
  assert.equal(before.fields.sitzungsleitung, "Anna");
  assert.equal(before.fields.protokollfuehrung, "Bea");
  assert.equal(before.fields.unterschriften, false);
  const next = updateProtocolFrontmatter(source, { sitzungsleitung: 'Clara: "A"', beginn: "18:00", unterschriften: true });
  const after = parseProtocolFrontmatter(next);
  assert.equal(after.fields.sitzungsleitung, 'Clara: "A"');
  assert.equal(after.fields.beginn, "18:00");
  assert.equal(after.fields.unterschriften, true);
  assert.equal(after.body, before.body);
  assert.ok(next.includes("# Keep this comment"));
  assert.deepEqual(after.document.toJS().tags, ["intern", "protokoll"]);
  assert.ok(!next.includes("sitzungsleiter:"));
});

test("frontmatter can be created, cleared, manually edited, and never duplicated", () => {
  const body = "# Sitzung\n\n## TOP 1\nText";
  const first = updateProtocolFrontmatter(body, { title: "Protokoll", author: "Person" });
  const next = updateProtocolFrontmatter(first, { author: "", title: "Manuell" });
  assert.equal(parseProtocolFrontmatter(next).fields.author, "");
  assert.equal((next.match(/^---$/gm) ?? []).length, 2);
  assert.equal(parseProtocolFrontmatter('---\nbeginn: 18:00\nunterschriften: false\n---\nText').fields.beginn, "18:00");
  assert.ok(next.endsWith(body));
});

test("malformed YAML, duplicate keys, complex known values and aliases are reported without data loss", () => {
  for (const header of ['title: [', 'title: a\ntitle: b', 'title: [a,b]', 'other: &x [a]\ntitle: *x']) {
    assert.throws(() => parseProtocolFrontmatter(`---\n${header}\n---\nText`));
    assert.throws(() => updateProtocolFrontmatter(`---\n${header}\n---\nText`, { title: "Neu" }));
  }
  assert.throws(() => parseProtocolFrontmatter('---\ntitle: Unfertig'));
});

test("agenda and attendance preserve YAML byte-for-byte and ignore headings inside YAML blocks", () => {
  const header = '---\r\ntitle: "Sitzung"\r\nnotes: |\r\n  ## TOP 99 Kein TOP\r\n---\r\n';
  const source = header + '# Sitzung\n\n## TOP 1 Bericht\nText\n';
  assert.deepEqual(getMarkdownHeadings(source).map(h => h.title), ["Sitzung", "TOP 1 Bericht"]);
  let next = syncProtocolAttendance(source, [], []);
  next = upsertAgenda(next);
  next = setAttendanceSectionIncluded(next, "members", false);
  assert.ok(next.startsWith(header));
  assert.equal((next.match(/TOP 99/g) ?? []).length, 1);
  assert.ok(next.includes('[TOP 1 Bericht](#top-1-bericht)'));
  assert.equal(syncProtocolAttendance('---\ntitle: unfinished', [], []), '---\ntitle: unfinished');
});
