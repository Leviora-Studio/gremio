// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHomePref } from "../lib/home-dashboard";

test("new and existing users see all home sections by default", () => {
  assert.deepEqual(normalizeHomePref(undefined), {
    tasks: true,
    boards: true,
    protocols: true,
    finances: true,
    inventories: true,
    order: ["tasks", "boards", "protocols", "finances", "inventories"],
  });
  assert.deepEqual(normalizeHomePref({ tasks: false, finances: false }), {
    tasks: false,
    boards: true,
    protocols: true,
    finances: false,
    inventories: true,
    order: ["tasks", "boards", "protocols", "finances", "inventories"],
  });
});

test("saved home order is validated, deduplicated and completed", () => {
  assert.deepEqual(
    normalizeHomePref({ order: ["protocols", "tasks", "protocols", "invalid", "boards"] }).order,
    ["protocols", "tasks", "boards", "finances", "inventories"],
  );
});
