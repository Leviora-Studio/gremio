// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

test("meeting area recycle-bin upgrade preserves existing settings, sessions, documents, grants and trashed children", { skip: !process.env.TEST_MEETING_AREA_TRASH_MIGRATION_DATABASE_URL }, async () => {
  const url = process.env.TEST_MEETING_AREA_TRASH_MIGRATION_DATABASE_URL!;
  assert.match(new URL(url).pathname, /^\/gremio_workflows_upgrade_test_/);
  const pool = new Pool({ connectionString: url }), temporary = await mkdtemp(join(tmpdir(), "gremio-area-trash-upgrade-"));
  try {
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count, "0");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 111);
    await mkdir(join(temporary, "meta")); await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const owner = (await pool.query("insert into users(username) values('area-trash-upgrade-owner') returning id")).rows[0].id;
    const area = (await pool.query("insert into meeting_areas(name,owner_id,word_template_path,default_topics,public_numbering) values('Original area',$1,'original-template.docx',$2,'roman') returning id", [owner, JSON.stringify([{ title: "Original default", durationMinutes: 10, section: "public", kind: "discussion" }])])).rows[0].id;
    await pool.query("insert into meeting_area_access(area_id,user_id,access_level) values($1,$2,'write')", [area, owner]);
    const meeting = (await pool.query("insert into meetings(area_id,owner_id,title,state) values($1,$2,'Original closed meeting','closed') returning id", [area, owner])).rows[0].id;
    const topic = (await pool.query("insert into meeting_topics(meeting_id,created_by,title,state,outcome) values($1,$2,'Original decision','treated','Original result') returning id", [meeting, owner])).rows[0].id;
    await pool.query("insert into meeting_documents(topic_id,filename,path,mime,size) values($1,'Original.pdf','never-read-original.pdf','application/pdf',123)", [topic]);
    const old = (await pool.query("insert into meetings(area_id,owner_id,title) values($1,$2,'Previously trashed') returning id", [area, owner])).rows[0].id;
    await pool.query("BEGIN");
    const trash = (await pool.query("insert into trash_entries(kind,entity_id,label,deleted_by,deleted_at,expires_at) values('meeting',$1,'Previously trashed',$2,now(),now()+interval '720 hours') returning id,deleted_at", [old, owner])).rows[0];
    await pool.query("select set_config('gremio.trash_move',$1,true)", [String(trash.id)]);
    await pool.query("update meetings set deleted_at=(select deleted_at from trash_entries where id=$1) where id=$2", [trash.id, old]); await pool.query("COMMIT");
    const inventory = (await pool.query("insert into inventory_boards(name,owner_id) values('Original inventory',$1) returning id", [owner])).rows[0].id;
    await pool.query("insert into inventory_items(board_id,name,quantity) values($1,'Original stock',7)", [inventory]);
    const tables = ["users", "meeting_areas", "meetings", "meeting_topics", "meeting_documents", "meeting_area_access", "trash_entries", "inventory_boards", "inventory_items"];
    const snapshot = async () => Promise.all(tables.map(async table => [table, (await pool.query(`select * from ${table} order by id`)).rows] as const));
    const before = await snapshot();
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const after = await snapshot();
    for (const [table, rows] of after) if (table === "meeting_areas") for (const row of rows) { assert.equal(row.deleted_at, null); delete row.deleted_at; }
    assert.deepEqual(after, before, "only the new nullable area marker is added; original data is untouched");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const repeated = await snapshot(); for (const [table, rows] of repeated) if (table === "meeting_areas") for (const row of rows) delete row.deleted_at;
    assert.deepEqual(repeated, before);
  } finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
});
