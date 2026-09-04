// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCardAttachmentVisible } from "../lib/card-attachment-visibility";

test("card attachments follow field visibility, except generated instructions", () => {
  const visible = new Set(["finance_request"]);
  assert.equal(
    isCardAttachmentVisible({ kind: "finance_request" }, visible),
    true,
  );
  assert.equal(
    isCardAttachmentVisible({ kind: "student_card" }, visible),
    false,
  );
  assert.equal(
    isCardAttachmentVisible({ kind: "other", uploadPurpose: "receipt" }, visible),
    false,
  );
  assert.equal(
    isCardAttachmentVisible(
      { kind: "other", uploadPurpose: "instruction" },
      visible,
    ),
    true,
  );
  assert.equal(isCardAttachmentVisible({ kind: "unknown" }, visible), false);
});
