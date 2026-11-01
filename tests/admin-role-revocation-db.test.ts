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
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import { users, type User } from "../lib/db/schema";

after(() => pool.end());
test("an admin snapshot cannot restore privileges after live revocation or deactivation", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const directory = await mkdtemp(join(tmpdir(), "gremio-admin-role-audit-"));
  const entry = join(directory, "actions.cjs");
  const context = globalThis as unknown as { __auditAdminSnapshot?: User };
  const people = await db.insert(users).values([
    { username: randomUUID(), role: "admin" },
    { username: randomUUID(), role: "admin" },
    { username: randomUUID(), role: "user" },
  ]).returning();
  const [actor, , target] = people;
  try {
    await build({ entryPoints: ["app/admin/users/actions.ts"], outfile: entry, platform: "node", format: "cjs", bundle: true, packages: "external", plugins: [{ name: "revoked-auth-snapshot", setup(builder) {
      builder.onResolve({ filter: /^(@\/lib\/auth|next\/cache)$/ }, args => ({ path: args.path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, args => ({ loader: "js", contents: args.path === "@/lib/auth" ? "export async function requireAdmin(){return globalThis.__auditAdminSnapshot;}" : "export function revalidatePath(){}" }));
    } }] });
    const require = createRequire(import.meta.url);
    const Module = require("node:module");
    const loaded = new Module(entry, module);
    loaded.filename = entry; loaded.paths = module.paths;
    loaded._compile(await readFile(entry, "utf8"), entry);
    context.__auditAdminSnapshot = actor;
    await loaded.exports.setRoleAction(target.id, "admin");
    assert.equal((await db.select().from(users).where(eq(users.id, target.id)))[0].role, "admin");
    await db.update(users).set({ role: "user" }).where(eq(users.id, target.id));
    // Simulate permission loss after initial request authentication, before
    // the action acquires its administrator locks.
    await db.update(users).set({ role: "user" }).where(eq(users.id, actor.id));
    await loaded.exports.setRoleAction(actor.id, "admin");
    assert.equal((await db.select().from(users).where(eq(users.id, actor.id)))[0].role, "user");
    await db.update(users).set({ role: "admin", isActive: false }).where(eq(users.id, actor.id));
    await loaded.exports.setRoleAction(target.id, "admin");
    assert.equal((await db.select().from(users).where(eq(users.id, target.id)))[0].role, "user");
  } finally {
    delete context.__auditAdminSnapshot;
    await db.delete(users).where(inArray(users.id, people.map(person => person.id)));
    await rm(directory, { recursive: true, force: true });
  }
});
