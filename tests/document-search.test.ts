// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDocumentMatches, nextDocumentMatch } from "../lib/document-search";

test("document search is literal, case insensitive and preserves Unicode offsets", () => {
  assert.deepEqual(findDocumentMatches("TOP top Top", "top"), [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
  assert.deepEqual(findDocumentMatches("A [x].* B [x].*", "[x].*"), [{ start: 2, end: 7 }, { start: 10, end: 15 }]);
  const text = "İ 😀 Gäste GÄSTE";
  const matches = findDocumentMatches(text, "gäste");
  assert.deepEqual(matches.map(hit => text.slice(hit.start, hit.end)), ["Gäste", "GÄSTE"]);
  assert.deepEqual(findDocumentMatches("Text", ""), []);
  assert.deepEqual(findDocumentMatches("Text", "xyz"), []);
});
test("document search navigation wraps forwards and backwards", () => {
  assert.equal(nextDocumentMatch(2, 3, 1), 0);
  assert.equal(nextDocumentMatch(0, 3, -1), 2);
  assert.equal(nextDocumentMatch(0, 1, -1), 0);
  assert.equal(nextDocumentMatch(0, 0, 1), 0);
});
