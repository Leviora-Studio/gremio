// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { openApiV1Spec } from "../lib/openapi-v1";
import { openApiPublicSpec } from "../lib/openapi-public";
import { cardWriteSchema } from "../lib/api-cards";
import { budgetPositionSchema } from "../lib/card-budget";
import { pool } from "../lib/db";

after(() => pool.end());

test("both published YAML documents match their canonical OpenAPI sources", () => {
  assert.deepEqual(parse(readFileSync("docs/openapi-v1.yaml", "utf8")), openApiV1Spec);
  assert.deepEqual(parse(readFileSync("docs/openapi-public.yaml", "utf8")), openApiPublicSpec);
});

test("every versioned business route/method is documented, namespaces remain separate", () => {
  for (const [root, spec] of [["app/api/v1", openApiV1Spec], ["app/api/public/v1", openApiPublicSpec]] as const) {
    const actual: string[] = [];
    for (const file of readdirSync(root, { recursive: true }).map(String).filter((path) => path.endsWith("route.ts"))) {
      if (file.startsWith("docs/") || file.startsWith("openapi.json/")) continue;
      const path = `/${join(root.slice(4), file.replace(/\/?route\.ts$/, ""))}`.replace(/\[(\w+)\]/g, "{$1}");
      const source = readFileSync(join(root, file), "utf8");
      for (const match of source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|DELETE|PUT)\b/g)) actual.push(`${match[1].toLowerCase()} ${path}`);
    }
    const documented = Object.entries(spec.paths).flatMap(([path, operations]) => Object.keys(operations).filter((method) => ["get", "post", "patch", "delete", "put"].includes(method)).map((method) => `${method} ${path}`));
    assert.deepEqual(actual.sort(), documented.sort());
  }
});

test("write schemas list actual accepted fields, distinguish read-only rows and require create title", () => {
  const schemas = openApiV1Spec.components.schemas;
  assert.deepEqual(Object.keys(schemas.CardWrite.properties).sort(), Object.keys(cardWriteSchema.shape).sort());
  assert.deepEqual(Object.keys(schemas.BudgetPositionWrite.properties).sort(), Object.keys(budgetPositionSchema.shape).sort());
  assert.deepEqual(schemas.CardCreate.required, ["title"]);
  assert.deepEqual(schemas.BudgetPositionWrite.required, ["id", "budgetTitle", "description", "accountId"]);
  assert.ok(!("position" in schemas.BudgetPositionWrite.properties));
  assert.ok("position" in schemas.BudgetPosition.properties);
  for (const key of ["number", "instructionDate", "transferDate"] as const) assert.doesNotMatch(schemas.CardWrite.properties[key].description, /Nur für Board-Verwalter/);
  const operations = openApiV1Spec.paths["/api/v1/boards/{id}/cards"];
  assert.equal(operations.post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/CardCreate");
  for (const example of Object.values(operations.post.requestBody.content["application/json"].examples)) assert.ok(cardWriteSchema.safeParse(example.value).success);
});

test("response examples include always-returned budget metadata and independent public workflow flags", () => {
  const internal = openApiV1Spec.paths["/api/v1/boards/{id}/cards"].post.responses[201].content["application/json"].example;
  assert.equal(internal.card.budgetMode, "single"); assert.equal(internal.card.budgetRevision, 0); assert.deepEqual(internal.budgetPositions, []);
  const publicExample = openApiPublicSpec.paths["/api/public/v1/status"].post.responses[200].content["application/json"].examples.antrag.value;
  assert.equal(publicExample.application.approvedAmountCents, 35000);
  assert.equal(typeof publicExample.availableActions.canResubmit, "boolean"); assert.equal(typeof publicExample.availableActions.canReceipt, "boolean");
});
