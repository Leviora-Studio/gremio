// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { decryptSecret } from "../lib/crypto";

export async function checkEmailSettings() {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const output = await mkdtemp(join(tmpdir(), "gremio-email-settings-"));
  const entry = join(output, "actions.cjs");
  await build({ stdin: { contents: `export * as smtp from ${JSON.stringify(join(process.cwd(), "app/admin/email/actions.ts"))}; export * as rules from ${JSON.stringify(join(process.cwd(), "app/intern/board/[id]/einstellungen/email-actions.ts"))};`, resolveDir: process.cwd() }, outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "request-context", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "test" }));
    builder.onResolve({ filter: /^next\/(navigation|cache)$/ }, ({ path }) => ({ path, namespace: "test" }));
    builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "auth" ? 'export async function requireUser(){if(!globalThis.__emailTestUser)throw Error("login");return globalThis.__emailTestUser;} export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("denied");return u;}' : 'export function notFound(){throw Error("not-found")} export function revalidatePath(){}', loader: "js" }));
  } }] });
  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
  loaded._compile(await readFile(entry, "utf8"), entry);
  const api = loaded.exports;
  const context = globalThis as unknown as { __emailTestUser?: schema.User };
  const name = randomUUID();
  const [owner, writer, admin] = await db.insert(schema.users).values([{ username: `${name}-owner` }, { username: `${name}-writer` }, { username: `${name}-admin`, role: "admin" as const }]).returning();
  const [board] = await db.insert(schema.boards).values({ name, ownerId: owner.id }).returning();
  const [inventory] = await db.insert(schema.inventoryBoards).values({ name, ownerId: owner.id }).returning();
  const [system] = await db.insert(schema.boards).values({ name, ownerId: owner.id, inventoryBoardId: inventory.id }).returning();
  await db.update(schema.inventoryBoards).set({ loanBoardId: system.id }).where(eq(schema.inventoryBoards.id, inventory.id));
  const [status, foreignStatus, systemStatus] = await db.insert(schema.boardStatuses).values([{ boardId: board.id, name: "Inbox" }, { boardId: system.id, name: "Foreign" }, { boardId: system.id, name: "Loans" }]).returning();
  await db.insert(schema.boardAccess).values({ boardId: board.id, userId: writer.id, accessLevel: "write" });
  const form = (values: Record<string, string>) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
  const smtpForm = (extra = {}) => form({ host: "localhost", port: "587", security: "starttls", username: "test-user", password: "synthetic-password", fromEmail: "sender@example.invalid", fromName: "Test", ...extra });
  try {
    delete context.__emailTestUser;
    await assert.rejects(api.smtp.saveSmtpAction({}, smtpForm()), /login/);
    for (const user of [owner, writer]) {
      context.__emailTestUser = user;
      await assert.rejects(api.smtp.saveSmtpAction({}, smtpForm()), /denied/);
      await assert.rejects(api.smtp.saveEmailConfirmationAction("application", board.id, form({ enabled: "on" })), /denied/);
      await assert.rejects(api.smtp.retryFailedEmailsAction(), /denied/);
      await assert.rejects(api.smtp.verifySmtpAction({}), /denied/);
    }
    context.__emailTestUser = writer;
    await assert.rejects(api.rules.saveBoardEmailRuleAction(board.id, status.id, {}, form({ enabled: "on", recipients: "a@example.invalid" })), /not-found/);
    context.__emailTestUser = owner;
    assert.ok((await api.rules.saveBoardEmailRuleAction(board.id, foreignStatus.id, {}, form({ recipients: "a@example.invalid" }))).error);
    assert.ok((await api.rules.saveBoardEmailRuleAction(board.id, status.id, {}, form({ enabled: "on", recipients: "invalid" }))).error);
    assert.ok((await api.rules.saveBoardEmailRuleAction(board.id, status.id, {}, form({ enabled: "on", recipients: "a@example.invalid; b@example.invalid" }))).success);
    assert.ok((await api.rules.saveBoardEmailRuleAction(system.id, systemStatus.id, {}, form({ enabled: "on", recipients: "a@example.invalid" }))).success);
    context.__emailTestUser = admin;
    assert.ok((await api.smtp.saveSmtpAction({}, smtpForm({ security: "none", host: "smtp.example.org" }))).error);
    assert.ok((await api.smtp.saveSmtpAction({}, smtpForm())).success);
    const [saved] = await db.select().from(schema.smtpSettings);
    assert.equal(saved.enabled, false); assert.notEqual(saved.passwordEnc, "synthetic-password"); assert.equal(decryptSecret(saved.passwordEnc!), "synthetic-password");
    assert.ok((await api.smtp.saveSmtpAction({}, smtpForm({ password: "" }))).success);
    assert.equal((await db.select().from(schema.smtpSettings))[0].passwordEnc, saved.passwordEnc);
    assert.ok((await api.smtp.saveSmtpAction({}, smtpForm({ username: "different", password: "" }))).error);
    await api.smtp.saveEmailConfirmationAction("application", board.id, form({ enabled: "on" }));
    await api.smtp.saveEmailConfirmationAction("application", board.id, form({}));
    assert.equal((await db.select().from(schema.emailConfirmationSettings)).find(row => row.boardId === board.id)?.enabled, false);
  } finally {
    delete context.__emailTestUser;
    await db.delete(schema.smtpSettings);
    await db.update(schema.inventoryBoards).set({ loanBoardId: null }).where(eq(schema.inventoryBoards.id, inventory.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, system.id));
    await db.delete(schema.inventoryBoards).where(eq(schema.inventoryBoards.id, inventory.id));
    await db.delete(schema.boards).where(eq(schema.boards.id, board.id));
    for (const user of [owner, writer, admin]) await db.delete(schema.users).where(eq(schema.users.id, user.id));
    await rm(output, { recursive: true, force: true });
  }
}
