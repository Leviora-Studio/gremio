// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, pool } from "../lib/db";
import { protocolAreas, protocolTemplates, users } from "../lib/db/schema";
import { changeProtocolLogo, getProtocolLogoBytes, getProtocolLogos, normalizeProtocolLogo } from "../lib/protocol-logos";

after(async () => { await pool.end(); });
test("logos reject disguised active files and normalize images", async () => {
  await assert.rejects(normalizeProtocolLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')));
  await assert.rejects(normalizeProtocolLogo(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#00aaff" } }).png().toBuffer();
  assert.equal((await sharp(await normalizeProtocolLogo(png)).metadata()).format, "png");
});

test("logos are area-scoped and keep exactly one default through uploads, changes and deletion", async t => {
  const suffix = `logo-${process.pid}-${Date.now()}`;
  const [owner, stranger] = await db.insert(users).values([{ username: `${suffix}-owner` }, { username: `${suffix}-other` }]).returning();
  const [template] = await db.insert(protocolTemplates).values({ name: suffix, markdown: "# Test" }).returning();
  const areas = await db.insert(protocolAreas).values(["A", "B"].map(name => ({ name: `${suffix}-${name}`, ownerId: owner.id, templateId: template.id, ncUrl: "https://example.invalid", ncUsername: "test", ncPasswordEnc: "unused", rootPath: "/P" }))).returning();
  t.after(async () => { await db.delete(protocolAreas).where(inArray(protocolAreas.id, areas.map(a => a.id))); await db.delete(protocolTemplates).where(eq(protocolTemplates.id, template.id)); await db.delete(users).where(inArray(users.id, [owner.id, stranger.id])); });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#00aaff" } }).png().toBuffer();
  const file = new File([new Uint8Array(png)], "Logo.png", { type: "image/png" });
  await assert.rejects(changeProtocolLogo(stranger, areas[0].id, { type: "upload", file }));
  await Promise.all([changeProtocolLogo(owner, areas[0].id, { type: "upload", file }), changeProtocolLogo(owner, areas[0].id, { type: "upload", file })]);
  const logos = await getProtocolLogos(areas[0].id);
  assert.equal(logos.length, 2); assert.equal(logos.filter(l => l.isDefault).length, 1);
  assert.equal(await getProtocolLogoBytes(areas[1].id, logos[0].id), null);
  await assert.rejects(changeProtocolLogo(owner, areas[1].id, { type: "default", logoId: logos[0].id }));
  const selected = await changeProtocolLogo(owner, areas[0].id, { type: "default", logoId: logos[1].id });
  assert.deepEqual(selected.filter(l => l.isDefault).map(l => l.id), [logos[1].id]);
  const remaining = await changeProtocolLogo(owner, areas[0].id, { type: "remove", logoId: logos[1].id });
  assert.equal(remaining[0].isDefault, true);
  assert.equal((await changeProtocolLogo(owner, areas[0].id, { type: "remove", logoId: remaining[0].id })).length, 0);
});
