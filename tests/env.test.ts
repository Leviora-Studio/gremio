// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { appOriginSchema } from "../lib/env";

test("app and public base URLs are pure HTTP(S) origins", () => {
  for (const valid of [
    "https://gremio.example",
    "https://gremio.example/",
    "http://localhost:3000",
  ]) {
    assert.equal(appOriginSchema.safeParse(valid).success, true, valid);
  }
  for (const invalid of [
    "javascript:alert(1)",
    "file:///tmp/gremio",
    "https://user:secret@gremio.example",
    "https://gremio.example/intern",
    "https://gremio.example/?from=test",
    "https://gremio.example/#fragment",
  ]) {
    assert.equal(appOriginSchema.safeParse(invalid).success, false, invalid);
  }
});
