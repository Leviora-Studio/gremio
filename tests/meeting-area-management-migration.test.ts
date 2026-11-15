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
test("meeting management upgrade preserves all existing data and grants no delegated rights automatically", { skip: !process.env.TEST_MEETING_MANAGEMENT_MIGRATION_DATABASE_URL }, async () => {
  const url=process.env.TEST_MEETING_MANAGEMENT_MIGRATION_DATABASE_URL!; assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
  const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-area-manager-upgrade-"));
  try {
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
    const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<112);
    await mkdir(join(temporary,"meta"));await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify(journal));
    for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(temporary,`${e.tag}.sql`));
    await migrate(drizzle(pool),{migrationsFolder:temporary});
    const owner=(await pool.query("insert into users(username) values('management-upgrade-owner') returning id")).rows[0].id;
    const writer=(await pool.query("insert into users(username) values('management-upgrade-writer') returning id")).rows[0].id;
    const area=(await pool.query("insert into meeting_areas(name,owner_id,word_template_path,public_numbering) values('Original area',$1,'original.docx','roman') returning id",[owner])).rows[0].id;
    await pool.query("insert into meeting_area_access(area_id,user_id,access_level) values($1,$2,'write')",[area,writer]);
    const meeting=(await pool.query("insert into meetings(area_id,owner_id,title) values($1,$2,'Original meeting') returning id",[area,owner])).rows[0].id;
    await pool.query("insert into meeting_topics(meeting_id,created_by,title,motion) values($1,$2,'Original TOP','Original motion')",[meeting,writer]);
    const tables=(await pool.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
    const snapshot=async()=>Promise.all(tables.map(async (table:string)=>[table,(await pool.query(`select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) as hash from ${table} t`)).rows[0].hash]));
    const before=await snapshot();await migrate(drizzle(pool),{migrationsFolder:"drizzle"});
    assert.deepEqual(await snapshot(),before);assert.equal((await pool.query("select count(*) from meeting_area_managers")).rows[0].count,"0");
    await migrate(drizzle(pool),{migrationsFolder:"drizzle"});assert.deepEqual(await snapshot(),before);
  } finally {await pool.end();await rm(temporary,{recursive:true,force:true});}
});
