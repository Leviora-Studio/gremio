// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

test("frozen-card archive upgrade preserves every stored value and only permits technical archive updates", { skip: !process.env.TEST_FROZEN_ARCHIVE_MIGRATION_DATABASE_URL }, async () => {
  const url = process.env.TEST_FROZEN_ARCHIVE_MIGRATION_DATABASE_URL!;
  assert.match(new URL(url).pathname, /^\/gremio_workflows_upgrade_test_/);
  const pool = new Pool({ connectionString: url }), temporary = await mkdtemp(join(tmpdir(), "gremio-frozen-archive-upgrade-"));
  try {
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count, "0", "requires an empty isolated database");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 104);
    await mkdir(join(temporary, "meta")); await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const owner = (await pool.query("insert into users(username) values ('archive-upgrade-owner') returning id")).rows[0].id;
    const board = (await pool.query("insert into boards(name,owner_id,is_application_board) values ('Original board',$1,true) returning id", [owner])).rows[0].id;
    const status = (await pool.query("insert into board_statuses(board_id,name,is_lock_column,is_archive_trigger) values ($1,'Original archive',true,true) returning id", [board])).rows[0].id;
    const card = (await pool.query("insert into cards(board_id,status_id,title,applicant,notes,token,locked_at,locked_by,archive_pending,archive_last_error) values ($1,$2,'Original title','Original applicant','Original notes','upgrade-pending',now(),$3,true,'Original failure') returning id", [board,status,owner])).rows[0].id;
    const archived = (await pool.query("insert into cards(board_id,status_id,title,applicant,token,locked_at,locked_by,nextcloud_link) values ($1,$2,'Original archive','Original applicant','upgrade-archived',now(),$3,'/original/archive') returning id", [board,status,owner])).rows[0].id;
    await pool.query("insert into attachments(card_id,kind,upload_purpose,filename,path,mime,size) values ($1,'other','receipt','Original_Q1.pdf','never-read.pdf','application/pdf',1)", [card]);
    await assert.rejects(pool.query("update cards set nextcloud_link='/new/archive' where id=$1", [card]));
    const tables = ["users", "boards", "board_statuses", "cards", "attachments"];
    const snapshot = async () => Promise.all(tables.map(async table => [table, (await pool.query(`select * from ${table} order by id`)).rows]));
    const before = await snapshot();
    const upgradedSnapshot=async()=>{const rows=await snapshot();for(const [table,values] of rows)if(table==="boards")for(const row of values as Record<string,unknown>[]) {assert.equal(row.deleted_at,null);delete row.deleted_at;}return rows;};
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.deepEqual(await upgradedSnapshot(), before, "upgrade preserves all existing content, locks, status and archive state");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.deepEqual(await upgradedSnapshot(), before, "repeated startup migration preserves the same values");
    await pool.query("update cards set nextcloud_link='/new/archive',archive_pending=false,archive_last_attempt_at=now(),archive_last_error=null where id=$1", [card]);
    for (const id of [card,archived]) {
      await assert.rejects(pool.query("update cards set title='Changed',archive_pending=false where id=$1", [id]));
      await assert.rejects(pool.query("update cards set locked_at=null where id=$1", [id]));
      await assert.rejects(pool.query("update cards set nextcloud_link=null where id=$1", [id]));
      await assert.rejects(pool.query("delete from cards where id=$1", [id]));
    }
  } finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
});
