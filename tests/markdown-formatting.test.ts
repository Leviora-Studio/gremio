// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMarkdown, indentMarkdown } from "../lib/markdown-formatting";

test("Tab indents list lines and preserves the caret and source outside the selection", () => {
  for (const line of ["- Child", "2. Child", "Plain", ""]) {
    const source = "---\nort: Test\n---\n- Parent\n" + line;
    const selection = { start: source.length, end: source.length };
    const edit = indentMarkdown(source, selection);
    assert.equal(edit.markdown, source.slice(0, source.length - line.length) + "    " + line);
    assert.deepEqual(edit.selection, { start: selection.start + 4, end: selection.end + 4 });
    assert.deepEqual(indentMarkdown(edit.markdown, edit.selection, true), { markdown: source, selection });
  }
});

test("indentation handles selected lines, boundary exclusions and existing whitespace", () => {
  const edit = indentMarkdown("A\nB\nC", { start: 0, end: 4 });
  assert.equal(edit.markdown, "    A\n    B\nC");
  assert.deepEqual(edit.selection, { start: 4, end: 12 });
  assert.deepEqual(indentMarkdown(edit.markdown, edit.selection, true), { markdown: "A\nB\nC", selection: { start: 0, end: 4 } });
  assert.deepEqual(indentMarkdown("  A\n\tB\nC", { start: 1, end: 8 }, true), { markdown: "A\nB\nC", selection: { start: 0, end: 5 } });
  assert.deepEqual(indentMarkdown("Text", { start: 2, end: 2 }, true), { markdown: "Text", selection: { start: 2, end: 2 } });
});

test("inline commands preserve surrounding source and select their content", () => {
  for (const [command, expected] of [["bold", "**Text**"], ["italic", "*Text*"], ["underline", "<u>Text</u>"], ["code", "`Text`"]] as const) {
    const edit = formatMarkdown("Vor Text danach", { start: 4, end: 8 }, command);
    assert.equal(edit.markdown, `Vor ${expected} danach`);
    assert.equal(edit.markdown.slice(edit.selection.start, edit.selection.end), "Text");
    assert.equal(formatMarkdown(edit.markdown, edit.selection, command).markdown, "Vor Text danach");
  }
  assert.equal(formatMarkdown("", { start: 0, end: 0 }, "bold").markdown, "**Text**");
});
test("headings and lists replace existing block markers without rewriting other lines", () => {
  const source = "# Titel\nAbsatz\n- Alt\nEnde";
  assert.equal(formatMarkdown(source, { start: 9, end: 9 }, "h2").markdown, "# Titel\n## Absatz\n- Alt\nEnde");
  assert.equal(formatMarkdown(source, { start: 8, end: 21 }, "ordered").markdown, "# Titel\n1. Absatz\n2. Alt\nEnde");
  assert.equal(formatMarkdown("## Titel", { start: 8, end: 8 }, "h1").markdown, "# Titel");
  assert.equal(formatMarkdown("A\nB", { start: 0, end: 2 }, "bullet").markdown, "- A\nB");
});
test("table commands insert bounded source tables and select the first header", () => {
  const edit = formatMarkdown("Text", { start: 4, end: 4 }, { table: { rows: 2, columns: 3 } });
  assert.equal(edit.markdown, "Text\n\n| Spalte 1 | Spalte 2 | Spalte 3 |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |\n\n");
  assert.equal(edit.markdown.slice(edit.selection.start, edit.selection.end), "Spalte 1");
  assert.throws(() => formatMarkdown("", { start: 0, end: 0 }, { table: { rows: 0, columns: 20 } }));
});
