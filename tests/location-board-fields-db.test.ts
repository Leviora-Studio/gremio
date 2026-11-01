// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as schema from "../lib/db/schema";
import { APPLICATION_CARD_FIELD_KEYS, CARD_FIELD_KEYS } from "../lib/constants";
import { serializeCard } from "../lib/api";
import { cardWriteSchema } from "../lib/api-cards";
import { getLocationRequiredFieldKeys } from "../lib/location-board-fields";

after(() => pool.end());

test("application routing locks form fields; internal email edits respect permissions and visibility", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-location-fields-"));
  const entry = join(output, "actions.cjs");
  const modules = { locations: "app/admin/standorte/actions.ts", fields: "app/intern/board/[id]/einstellungen/actions.ts", card: "app/intern/card/[id]/actions.ts" };
  await build({ stdin: { contents: Object.entries(modules).map(([key, path]) => `export * as ${key} from ${JSON.stringify(join(process.cwd(), path))};`).join("\n"), resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){if(!globalThis.__locationFieldTestUser)throw Error("login");return globalThis.__locationFieldTestUser;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("denied");return u;}' : 'export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports;
  const context = globalThis as unknown as { __locationFieldTestUser?: schema.User };
  const name = `fields-${randomUUID()}`;
  const [admin, reader, writer] = await db.insert(schema.users).values([{ username: `${name}-admin`, role: "admin" as const }, { username: `${name}-reader` }, { username: `${name}-writer` }]).returning();
  const [board, other] = await db.insert(schema.boards).values([{ name, ownerId: admin.id }, { name: `${name}-other`, ownerId: admin.id }]).returning();
  const [status, otherStatus] = await db.insert(schema.boardStatuses).values([{ boardId: board.id, name: "Inbox" }, { boardId: other.id, name: "Inbox" }]).returning();
  const [location, second] = await db.insert(schema.locations).values([{ name, enabled: false }, { name: `${name}-second`, enabled: false }]).returning();
  const form = (values: Record<string, string>) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
  const allFields = form(Object.fromEntries(CARD_FIELD_KEYS.map(key => [`field_${key}`, "on"])));
  const visible = async (id = board.id) => (await db.select().from(schema.boardCardFields).where(eq(schema.boardCardFields.boardId, id))).filter(row => row.visible).map(row => row.fieldKey).sort();
  const target = (id = board.id, statusId = status.id) => form({ boardId: String(id), statusId: String(statusId) });
  try {
    context.__locationFieldTestUser = admin;
    assert.ok((await api.locations.setLocationTargetAction(location.id, {}, target())).success);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort(), "assignment enables optional uploads too");
    assert.deepEqual(await getLocationRequiredFieldKeys(board.id), [], "inactive route does not lock fields");
    assert.ok((await api.fields.setCardFieldsAction(board.id, {}, new FormData())).success);
    assert.deepEqual(await visible(), []);
    assert.ok((await api.locations.toggleLocationEnabledAction(location.id)).success);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort());
    assert.ok((await api.fields.setCardFieldsAction(board.id, {}, new FormData())).error);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort(), "rejected update is atomic");
    assert.ok((await api.fields.setCardFieldsAction(board.id, {}, allFields)).success);
    await api.locations.setLocationTargetAction(second.id, {}, target());
    await api.locations.toggleLocationEnabledAction(second.id);
    await api.locations.toggleLocationEnabledAction(location.id);
    assert.ok((await api.fields.setCardFieldsAction(board.id, {}, new FormData())).error, "another active location still protects the board");
    await api.locations.setLocationTargetAction(second.id, {}, target(other.id, otherStatus.id));
    assert.deepEqual(await visible(other.id), [...APPLICATION_CARD_FIELD_KEYS].sort());
    assert.ok((await api.fields.setCardFieldsAction(board.id, {}, new FormData())).success, "old target unlocks after rerouting");
    await api.locations.setLocationTargetAction(second.id, {}, form({ boardId: "" }));
    assert.ok((await api.fields.setCardFieldsAction(other.id, {}, new FormData())).success);

    // Both operations serialize on the same board; neither ordering can hide an active form field.
    await Promise.all([api.locations.toggleLocationEnabledAction(location.id), api.fields.setCardFieldsAction(board.id, {}, new FormData())]);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort());

    await db.insert(schema.boardAccess).values([{ boardId: board.id, userId: reader.id, accessLevel: "read" }, { boardId: board.id, userId: writer.id, accessLevel: "write" }]);
    const [card] = await db.insert(schema.cards).values({ boardId: board.id, statusId: status.id, title: "Email", applicant: "Person", token: randomUUID() }).returning();
    context.__locationFieldTestUser = writer;
    assert.ok((await api.card.saveCardAction(card.id, { submitterEmail: " person@example.org " })).ok);
    const email = async () => (await db.select().from(schema.cards).where(eq(schema.cards.id, card.id)))[0].submitterEmail;
    assert.equal(await email(), "person@example.org");
    const [stored] = await db.select().from(schema.cards).where(eq(schema.cards.id, card.id));
    assert.ok(!JSON.stringify(serializeCard(stored, undefined, new Set(CARD_FIELD_KEYS))).includes("person@example.org"), "contact stays out of REST and MCP responses");
    assert.equal(cardWriteSchema.safeParse({ submitterEmail: "person@example.org" }).success, false, "API write scope stays unchanged");
    for (const value of ["invalid", "person@example.org\r\nBcc: other@example.org"]) {
      assert.equal((await api.card.saveCardAction(card.id, { submitterEmail: value })).ok, false);
      assert.equal(await email(), "person@example.org");
    }
    assert.ok((await api.card.saveCardAction(card.id, { submitterEmail: "" })).ok);
    assert.equal(await email(), null);
    await api.card.saveCardAction(card.id, { submitterEmail: "person@example.org" });
    context.__locationFieldTestUser = reader;
    await assert.rejects(() => api.card.saveCardAction(card.id, { submitterEmail: "changed@example.org" }));
    context.__locationFieldTestUser = admin;
    await api.locations.toggleLocationEnabledAction(location.id);
    await api.fields.setCardFieldsAction(board.id, {}, new FormData());
    assert.ok((await api.card.saveCardAction(card.id, { submitterEmail: "hidden@example.org" })).ok);
    assert.equal(await email(), "person@example.org", "hidden values survive attempted edits");

    // Existing active routes and missing email configurations are repaired by the migration.
    await db.update(schema.locations).set({ enabled: true }).where(eq(schema.locations.id, location.id));
    await db.delete(schema.boardCardFields).where(and(eq(schema.boardCardFields.boardId, board.id), eq(schema.boardCardFields.fieldKey, "submitter_email")));
    const migration = await readFile(join(process.cwd(), "drizzle/0087_application_card_fields.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort());
  } finally {
    delete context.__locationFieldTestUser;
    await db.delete(schema.locations).where(eq(schema.locations.id, location.id));
    await db.delete(schema.locations).where(eq(schema.locations.id, second.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, board.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, other.id));
    for (const user of [admin, reader, writer]) await db.delete(schema.users).where(eq(schema.users.id, user.id));
    await rm(output, { recursive: true, force: true });
  }
});
