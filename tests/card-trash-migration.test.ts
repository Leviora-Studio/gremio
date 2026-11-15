// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,mkdir,readFile,writeFile,copyFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
test("card-bin upgrade preserves all existing cards, locks, attachments and archive metadata",{skip:!process.env.TEST_CARD_TRASH_MIGRATION_DATABASE_URL},async()=>{
 const url=process.env.TEST_CARD_TRASH_MIGRATION_DATABASE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-card-bin-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<113);await mkdir(join(temporary,"meta"));await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify(journal));for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(temporary,`${e.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:temporary});
  const owner=(await pool.query("insert into users(username) values('card-bin-upgrade-owner') returning id")).rows[0].id;const board=(await pool.query("insert into boards(name,owner_id,is_application_board) values('Original board',$1,true) returning id",[owner])).rows[0].id;const status=(await pool.query("insert into board_statuses(board_id,name,is_lock_column) values($1,'Original status',true) returning id",[board])).rows[0].id;
  const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token,number,notes) values($1,$2,'Original card','Original applicant','original-upgrade-token','A-123','Original notes') returning id",[board,status])).rows[0].id;
  await pool.query("insert into card_budget_plans(card_id,allocations,revision) values($1,$2,7)",[card,JSON.stringify([{amount:12345,budgetTitle:"Original title",accountId:null}])]);await pool.query("insert into attachments(card_id,kind,filename,path,mime,size) values($1,'finance_request','Original.pdf','original-stored-path.pdf','application/pdf',123)",[card]);await pool.query("insert into card_comments(card_id,user_id,body) values($1,$2,'Original comment')",[card,owner]);await pool.query("update cards set locked_at=now(),locked_by=$2,nextcloud_link='/original/archived' where id=$1",[card,owner]);
  const tables=(await pool.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
  const snapshot=async()=>Promise.all(tables.map(async(table:string)=>[table,(await pool.query(`select md5(coalesce(string_agg((to_jsonb(t)-$1::text)::text,'' order by (to_jsonb(t)-$1::text)::text),'')) as hash from ${table} t`,[table==="cards"?"deleted_at":"__unused__"])).rows[0].hash]));const before=await snapshot();await migrate(drizzle(pool),{migrationsFolder:"drizzle"});assert.deepEqual(await snapshot(),before);assert.equal((await pool.query("select deleted_at from cards where id=$1",[card])).rows[0].deleted_at,null);await assert.rejects(pool.query("update cards set title='Forbidden' where id=$1",[card]));await migrate(drizzle(pool),{migrationsFolder:"drizzle"});assert.deepEqual(await snapshot(),before);
 }finally{await pool.end();await rm(temporary,{recursive:true,force:true});}
});
