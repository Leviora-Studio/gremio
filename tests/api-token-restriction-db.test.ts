// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { apiTokens, boards, users, type User } from "../lib/db/schema";
import { authenticateApiToken, generateApiToken } from "../lib/api-token";

after(() => pool.end());

test("API token creation rejects stale board selections and serializes the account quota", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const directory = await mkdtemp(join(tmpdir(), "gremio-token-restriction-test-"));
  const entry = join(directory, "actions.cjs");
  const context = globalThis as unknown as { __tokenAuditUser?: User };
  const [owner] = await db.insert(users).values({ username: randomUUID() }).returning();
  const [board] = await db.insert(boards).values({ name: "Token selection", ownerId: owner.id }).returning();
  try {
    await build({ entryPoints: ["app/intern/konto/actions.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "token-request-wrappers", setup(builder) {
      builder.onResolve({ filter: /^(@\/lib\/auth|next\/cache)$/ }, args => ({ path: args.path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, args => ({ loader: "js", contents: args.path === "@/lib/auth" ? "export async function requireUser(){return globalThis.__tokenAuditUser;}" : "export function revalidatePath(){}" }));
    } }] });
    const require = createRequire(import.meta.url);
    const Module = require("node:module");
    const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = module.paths;
    loaded._compile(await readFile(entry, "utf8"), entry);
    const create = loaded.exports.createApiTokenAction;
    context.__tokenAuditUser = owner;
    for (const boardIds of [[2147483647], [board.id, 2147483647], ["1"], Array(1001).fill(board.id)]) {
      assert.equal((await create({ name: "Stale selection", scope: "read", boardIds })).ok, false, "a selected restriction must never silently become all-board access");
    }
    assert.equal((await db.select().from(apiTokens).where(eq(apiTokens.userId, owner.id))).length, 0);
    const restricted = await create({ name: "Restricted", scope: "read", boardIds: [board.id] });
    assert.equal(restricted.ok, true);
    assert.deepEqual((await authenticateApiToken(`Bearer ${restricted.token}`))?.boardIds, new Set([board.id]));
    await db.delete(apiTokens).where(eq(apiTokens.userId, owner.id));
    const unrestricted = await create({ name: "Explicit all boards", scope: "read", boardIds: [] });
    assert.equal(unrestricted.ok, true);
    assert.equal((await authenticateApiToken(`Bearer ${unrestricted.token}`))?.boardIds, null);
    for (let i = 1; i < 19; i++) {
      const { hash, prefix } = generateApiToken();
      await db.insert(apiTokens).values({ userId: owner.id, name: "Quota fixture", tokenHash: hash, prefix, scope: "read" });
    }
    const simultaneous = await Promise.all(Array.from({ length: 4 }, (_, i) => create({ name: `Parallel ${i}`, scope: "read", boardIds: [] })));
    assert.equal(simultaneous.filter(result => result.ok).length, 1);
    assert.equal((await db.select().from(apiTokens).where(eq(apiTokens.userId, owner.id))).length, 20);
    await db.delete(apiTokens).where(eq(apiTokens.userId, owner.id));
    await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
    assert.equal((await create({ name: "Revoked session", scope: "read", boardIds: [] })).ok, false);
  } finally {
    delete context.__tokenAuditUser;
    await db.delete(boards).where(eq(boards.id, board.id));
    await db.delete(users).where(eq(users.id, owner.id));
    await rm(directory, { recursive: true, force: true });
  }
});
