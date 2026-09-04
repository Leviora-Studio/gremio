// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownLineAt, markdownLineStart, remapMarkdownOffset, replaceMarkdownRange } from "../lib/protocol-live-editor";

test("live editor maps empty lines, line boundaries and end-of-document correctly", () => {
  assert.deepEqual(markdownLineAt("", 0), { index: 0, start: 0, end: 0 });
  assert.deepEqual(markdownLineAt("\n## TOP 1\n", 0), { index: 0, start: 0, end: 0 });
  assert.deepEqual(markdownLineAt("\n## TOP 1\n", 1), { index: 1, start: 1, end: 9 });
  assert.deepEqual(markdownLineAt("\n## TOP 1\n", 9), { index: 1, start: 1, end: 9 });
  assert.deepEqual(markdownLineAt("\n## TOP 1\n", 100), { index: 2, start: 10, end: 10 });
  const source = "# Sitzung\n\nUmlaute äöü und 😀\n| Name | Ja |\n";
  for (let index = 0; index < source.split("\n").length; index++) {
    const start = markdownLineStart(source, index);
    assert.equal(markdownLineAt(source, start).index, index);
    assert.equal(source.slice(start).split("\n")[0], source.split("\n")[index]);
  }
});

test("external metadata and attendance changes preserve the cursor anchor", () => {
  const before = "# Titel\nText\nEnde";
  const header = "---\nprotokollfuehrung: Anna\n---\n";
  assert.equal(remapMarkdownOffset(before, header + before, before.length), header.length + before.length);
  assert.equal(remapMarkdownOffset(before, header + before, 9), header.length + 9);
  assert.equal(remapMarkdownOffset(header + before, before, header.length + 9), 9);
  assert.equal(remapMarkdownOffset(before, "# Titel\nNeuer Text\nEnde", 3), 3);
});

test("live line edits and multiline paste preserve surrounding source and hidden markers", () => {
  const source = "<!-- gremio:finance:start card=1 -->\n## TOP 1\nNotiz\n<!-- gremio:finance:end card=1 -->";
  const start = markdownLineStart(source, 2);
  const result = replaceMarkdownRange(source, start, start + 5, "Erste Zeile\nZweite Zeile\n");
  assert.equal(result.markdown, source.replace("Notiz", "Erste Zeile\nZweite Zeile\n"));
  assert.equal(markdownLineAt(result.markdown, result.offset).index, 4);
  const merged = replaceMarkdownRange("Erste\nZweite", 5, 6, "");
  assert.deepEqual(merged, { markdown: "ErsteZweite", offset: 5 });
});
