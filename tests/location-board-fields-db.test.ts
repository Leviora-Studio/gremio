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
import { APPLICATION_CARD_FIELD_KEYS, APPLICATION_REQUIRED_CARD_FIELD_KEYS, CARD_FIELD_KEYS } from "../lib/constants";
import { serializeCard } from "../lib/api";
import { cardWriteSchema } from "../lib/api-cards";
import { getLocationRequiredFieldKeys } from "../lib/location-board-fields";

after(() => pool.end());

test("application routing locks form fields; internal email edits respect permissions and visibility", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-location-fields-"));
  const entry = join(output, "actions.cjs");
  const modules = { locations: "app/admin/standorte/actions.ts", fields: "app/intern/board/[id]/einstellungen/actions.ts", feedback: "app/admin/umfragen/actions.ts", card: "app/intern/card/[id]/actions.ts" };
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
  let feedbackId:number|undefined,inventoryId:number|undefined;
  try {
    context.__locationFieldTestUser = admin;
    const rejected=await api.locations.setLocationTargetAction(location.id,{},target());
    assert.match(rejected.error,/E-Mail-Adresse/);assert.deepEqual(await visible(),[],"assignment must not silently enable fields");
    await api.fields.setCardFieldsAction(board.id,{},allFields);
    assert.ok((await api.locations.setLocationTargetAction(location.id,{},target())).success);
    assert.deepEqual(await getLocationRequiredFieldKeys(board.id),[...APPLICATION_REQUIRED_CARD_FIELD_KEYS],"inactive linked routes also lock required fields");
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},new FormData())).error);
    const requiredOnly=form(Object.fromEntries(APPLICATION_REQUIRED_CARD_FIELD_KEYS.map(key=>[`field_${key}`,"on"])));
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},requiredOnly)).success,"optional uploads remain configurable");
    assert.deepEqual(await visible(),[...APPLICATION_REQUIRED_CARD_FIELD_KEYS].sort());
    assert.ok((await api.locations.toggleLocationEnabledAction(location.id)).success);
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},new FormData())).error);
    await api.locations.setLocationTargetAction(second.id,{},target());
    await api.locations.toggleLocationEnabledAction(second.id);
    await api.locations.toggleLocationEnabledAction(location.id);
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},new FormData())).error,"disabled location still protects fields");
    assert.ok((await api.locations.setLocationTargetAction(second.id,{},target(other.id,otherStatus.id))).error);
    await api.fields.setCardFieldsAction(other.id,{},allFields);
    await api.locations.setLocationTargetAction(second.id,{},target(other.id,otherStatus.id));
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},new FormData())).error,"first disabled location still linked");
    await api.locations.setLocationTargetAction(location.id,{},form({boardId:""}));
    assert.ok((await api.fields.setCardFieldsAction(board.id,{},new FormData())).success,"unlinking releases the fields");
    await api.locations.setLocationTargetAction(second.id,{},form({boardId:""}));
    assert.ok((await api.fields.setCardFieldsAction(other.id,{},new FormData())).success);
    // Racing assignment and hiding fields serialize; no linked board may lose mandatory fields.
    await api.fields.setCardFieldsAction(board.id,{},allFields);
    const [assignment,hidden]=await Promise.all([api.locations.setLocationTargetAction(location.id,{},target()),api.fields.setCardFieldsAction(board.id,{},new FormData())]);
    assert.ok(assignment.error||hidden.error);
    if(assignment.success){const fields=await visible();assert.ok(APPLICATION_REQUIRED_CARD_FIELD_KEYS.every(key=>fields.includes(key)));}
    else{await api.fields.setCardFieldsAction(board.id,{},allFields);await api.locations.setLocationTargetAction(location.id,{},target());}
    await api.locations.toggleLocationEnabledAction(location.id);

    const [feedbackArea]=await db.insert(schema.feedbackAreas).values({name:`${name}-survey`,enabled:false}).returning();feedbackId=feedbackArea.id;
    assert.match((await api.feedback.setFeedbackAreaTargetAction(feedbackId,{},target(other.id,otherStatus.id))).error,/Notiz/);
    const notesOnly=form({field_notes:"on"});await api.fields.setCardFieldsAction(other.id,{},notesOnly);
    assert.ok((await api.feedback.setFeedbackAreaTargetAction(feedbackId,{},target(other.id,otherStatus.id))).success);
    assert.deepEqual(await getLocationRequiredFieldKeys(other.id),["notes"]);
    assert.ok((await api.fields.setCardFieldsAction(other.id,{},new FormData())).error);
    assert.ok((await api.fields.setCardFieldsAction(other.id,{},notesOnly)).success,"survey does not require email/name fields");
    await api.feedback.setFeedbackAreaTargetAction(feedbackId,{},form({boardId:""}));
    assert.ok((await api.fields.setCardFieldsAction(other.id,{},new FormData())).success);
    const [inventory]=await db.insert(schema.inventoryBoards).values({name:`${name}-inventory`,ownerId:admin.id,loanBoardId:other.id}).returning();inventoryId=inventory.id;
    await db.update(schema.boards).set({inventoryBoardId:inventoryId}).where(eq(schema.boards.id,other.id));
    assert.deepEqual(await getLocationRequiredFieldKeys(other.id),["applicant","submitter_email","notes"]);
    await assert.rejects(api.fields.setCardFieldsAction(other.id,{},new FormData()),/not-found/,"system-managed loan boards cannot change card field settings");

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
    await api.locations.setLocationTargetAction(location.id,{},form({boardId:""}));
    await api.fields.setCardFieldsAction(board.id, {}, new FormData());
    assert.ok((await api.card.saveCardAction(card.id, { submitterEmail: "hidden@example.org" })).ok);
    assert.equal(await email(), "person@example.org", "hidden values survive attempted edits");

    // Existing active routes and missing email configurations are repaired by the migration.
    await db.update(schema.locations).set({ enabled: true,targetBoardId:board.id,targetStatusId:status.id }).where(eq(schema.locations.id, location.id));
    await db.delete(schema.boardCardFields).where(and(eq(schema.boardCardFields.boardId, board.id), eq(schema.boardCardFields.fieldKey, "submitter_email")));
    const migration = await readFile(join(process.cwd(), "drizzle/0087_application_card_fields.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    assert.deepEqual(await visible(), [...APPLICATION_CARD_FIELD_KEYS].sort());
  } finally {
    delete context.__locationFieldTestUser;
    if(feedbackId)await db.delete(schema.feedbackAreas).where(eq(schema.feedbackAreas.id,feedbackId));
    if(inventoryId){await db.update(schema.boards).set({inventoryBoardId:null}).where(eq(schema.boards.id,other.id));await db.delete(schema.inventoryBoards).where(eq(schema.inventoryBoards.id,inventoryId));}
    await db.delete(schema.locations).where(eq(schema.locations.id, location.id));
    await db.delete(schema.locations).where(eq(schema.locations.id, second.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, board.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, other.id));
    for (const user of [admin, reader, writer]) await db.delete(schema.users).where(eq(schema.users.id, user.id));
    await rm(output, { recursive: true, force: true });
  }
});
