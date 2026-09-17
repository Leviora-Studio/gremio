// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHomePref } from "../lib/home-dashboard";

test("new and existing users see all home sections by default", () => {
  assert.deepEqual(normalizeHomePref(undefined), {
    tasks: true,
    boards: true,
    finances: true,
    inventories: true,
    order: ["tasks", "boards", "finances", "inventories"],
  });
  assert.deepEqual(normalizeHomePref({ tasks: false, finances: false }), {
    tasks: false,
    boards: true,
    finances: false,
    inventories: true,
    order: ["tasks", "boards", "finances", "inventories"],
  });
});

test("saved home order is validated, deduplicated and completed", () => {
  assert.deepEqual(
    normalizeHomePref({ order: ["protocols", "tasks", "protocols", "invalid", "boards"] }).order,
    ["tasks", "boards", "finances", "inventories"],
  );
});

test("retired home sections are ignored without changing remaining preferences", () => {
  assert.deepEqual(normalizeHomePref({
    protocols: true,
    tasks: false,
    boards: false,
    inventories: false,
    order: ["protocols", "inventories", "boards", "tasks", "finances"],
  }), {
    tasks: false, boards: false, finances: true, inventories: false,
    order: ["inventories", "boards", "tasks", "finances"],
  });
});
