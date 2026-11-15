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
test("archive outbox upgrade recovers missed eligible cards without rewriting content, locks, failures or recorded successes", { skip: !process.env.TEST_ARCHIVE_OUTBOX_MIGRATION_DATABASE_URL }, async () => {
 const url=process.env.TEST_ARCHIVE_OUTBOX_MIGRATION_DATABASE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
 const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-outbox-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<109);
  await mkdir(join(temporary,"meta"));await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify(journal));for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(temporary,`${e.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:temporary});
  const owner=(await pool.query("insert into users(username) values('outbox-upgrade') returning id")).rows[0].id;
  const board=(await pool.query("insert into boards(name,owner_id,is_application_board) values('Original archive board',$1,true) returning id",[owner])).rows[0].id;
  const [incoming,archive,locked]=(await pool.query("insert into board_statuses(board_id,name,is_archive_trigger,is_lock_column) values($1,'Incoming',false,false),($1,'Archive',true,false),($1,'Locked archive',true,true) returning id",[board])).rows;
  await pool.query("insert into board_archive(board_id,enabled,nc_url,nc_username,nc_password_enc,target_folder) values($1,true,'https://synthetic.invalid','original','not-decrypted-in-this-test','/original')",[board]);
  const make=async(status:number,options:{frozen?:boolean;failed?:boolean;link?:string}={})=>(await pool.query("insert into cards(board_id,status_id,title,applicant,token,locked_at,locked_by,archive_pending,archive_first_failed_at,archive_last_error,nextcloud_link) values($1,$2,'Original title','Original person',gen_random_uuid()::text,case when $3 then now() else null end,case when $3 then $4::integer else null end,$5,case when $5 then now() else null end,case when $5 then 'Original error' else null end,$6) returning id",[board,status,!!options.frozen,owner,!!options.failed,options.link??null])).rows[0].id;
  const missed=await make(archive.id),missedLock=await make(locked.id),failed=await make(archive.id,{failed:true});
  const waiting=await make(locked.id),successful=await make(locked.id,{frozen:true,link:'/original/success'}),other=await make(incoming.id);
  await pool.query("insert into attachments(card_id,kind,filename,path,mime,size) values($1,'finance_request','Original.pdf','original/never-read.pdf','application/pdf',123)",[missedLock]);
  await pool.query("update cards set locked_at=now(),locked_by=$1 where id=$2",[owner,missedLock]);
  const tables=['users','boards','board_statuses','board_archive','cards','attachments','card_activity'];const snapshot=()=>Promise.all(tables.map(async table=>[table,(await pool.query(`select * from ${table} order by ${table==='board_archive'?'board_id':'id'}`)).rows]));
  const before=await snapshot();await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual(await snapshot(),before);
  const jobs=(await pool.query('select * from nextcloud_archive_jobs order by card_id')).rows;assert.deepEqual(jobs.map(row=>row.card_id),[missed,missedLock,failed].sort((a,b)=>a-b));for(const row of jobs){assert.equal(row.attempts,0);assert.equal(row.last_error,null);}
  for(const id of [waiting,successful,other])assert.ok(!jobs.some(row=>row.card_id===id));
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual((await pool.query('select * from nextcloud_archive_jobs order by card_id')).rows,jobs);
  await pool.query('update cards set locked_at=now(),locked_by=$1 where id=$2',[owner,waiting]);assert.equal((await pool.query('select card_id from nextcloud_archive_jobs where card_id=$1',[waiting])).rowCount,1);
  await assert.rejects(pool.query("update cards set title='Changed' where id=$1",[missedLock]));
 }finally{await pool.end();await rm(temporary,{recursive:true,force:true});}
});
