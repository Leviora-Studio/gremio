// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeTableInput, inlineTokenMarkdown, parseInlineMarkdown, parseRichLine, richInlineHtml, tableCellRanges, type InlineToken } from "../lib/markdown-rich-editor";

test("rich line offsets preserve the exact structural whitespace", () => {
  for (const source of ["##  Heading", "  ###\tHeading", "-  Item", "  3)\tItem", "> Quoted", "plain"]) {
    const line = parseRichLine(source);
    assert.equal(line.prefix + line.content, source);
  }
  assert.equal(parseRichLine("## Heading").level, 2);
  assert.equal(parseRichLine("- Item").marker, "•");
  assert.equal(parseRichLine("2. Item").kind, "ordered");
  assert.equal(parseRichLine("#not-a-heading").kind, "plain");
});
test("supported inline tokens round-trip without rewriting source", () => {
  const serialize = (token: InlineToken): string => inlineTokenMarkdown(token.type, token.children ? token.children.map(serialize).join("") : token.source, token.href);
  for (const source of ["**bold** and *italic*", "<u>under **bold**</u>", "`code`", "[Label](https://example.invalid)", "[Section](#test)", "unfinished **text", "plain & <script>", "\\*literal\\*", "A\\|B"]) {
    assert.equal(parseInlineMarkdown(source).map(serialize).join(""), source);
  }
});
test("rendered inline HTML escapes source and never injects active links or raw HTML", () => {
  assert.equal(richInlineHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(richInlineHtml("**Hello**"), '<strong data-md-token="strong">Hello</strong>');
  assert.equal(richInlineHtml("**Hello**", true), "**Hello**");
  assert.ok(!richInlineHtml('[x](https://example.invalid/"onmouseover="x)').includes(' onmouseover='));
  assert.ok(!richInlineHtml("[x](javascript:alert(1))").includes("<a"));
  assert.ok(richInlineHtml("[Link](https://example.invalid)", false, true).includes('href="https://example.invalid" target="_blank" rel="noopener noreferrer"'));
  assert.ok(!richInlineHtml("[x](javascript:alert(1))", false, true).includes("href="));
});
test("table ranges preserve typed spaces and exact neighboring columns", () => {
  const source = "| Anna | StuRa  | Hallo |";
  const cells = tableCellRanges(source);
  assert.deepEqual(cells.map(cell => cell.content), ["Anna", "StuRa ", "Hallo"]);
  for (const cell of cells) assert.equal(source.slice(cell.start, cell.end), cell.content);
  assert.deepEqual(tableCellRanges("|  |  |").map(cell => cell.content), ["", ""]);
  const middle = cells[1];
  assert.equal(source.slice(0, middle.start) + "StuRa live" + source.slice(middle.end), "| Anna | StuRa live | Hallo |");
});
test("literal pipes stay within their table cell", () => {
  assert.equal(escapeTableInput("A|B\nC"), "A\\|B C");
  assert.equal(tableCellRanges("| A\\|B | C |").length, 2);
  assert.equal(tableCellRanges("| A\\\\| B | C |").length, 3);
});
