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
test("file recycle-bin migration preserves all active attachments, frozen cards and existing resource-bin entries", {skip:!process.env.TEST_ATTACHMENT_TRASH_MIGRATION_DATABASE_URL}, async()=>{
 const url=process.env.TEST_ATTACHMENT_TRASH_MIGRATION_DATABASE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
 const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-file-trash-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<107);
  await mkdir(join(temporary,"meta"));await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify(journal));for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(temporary,`${e.tag}.sql`));
  await migrate(drizzle(pool),{migrationsFolder:temporary});
  const user=(await pool.query("insert into users(username,role) values('file-upgrade','admin') returning id")).rows[0].id;
  const board=(await pool.query("insert into boards(name,owner_id,is_application_board) values('Original',$1,true) returning id",[user])).rows[0].id;
  const status=(await pool.query("insert into board_statuses(board_id,name) values($1,'Original') returning id",[board])).rows[0].id;
  const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token) values($1,$2,'Original card','Original person','file-upgrade-original') returning id",[board,status])).rows[0].id;
  await pool.query("insert into attachments(card_id,kind,filename,path,mime,size,uploaded_by) values($1,'finance_request','Original application.pdf','original/never-read.pdf','application/pdf',1234,$2),($1,'other','Original receipt.pdf','original/receipt-never-read.pdf','application/pdf',4321,$2)",[card,user]);
  await pool.query("update cards set locked_at=now(),locked_by=$1 where id=$2",[user,card]);
  const template=(await pool.query("insert into board_templates(name) values('Prior recycle bin') returning id")).rows[0].id;
  const client=await pool.connect();try{await client.query('BEGIN');const bin=(await client.query("insert into trash_entries(kind,entity_id,label,deleted_by,deleted_at,expires_at) values('board_template',$1,'Prior recycle bin',$2,now(),now()+interval '120 hours') returning id,deleted_at",[template,user])).rows[0];await client.query("select set_config('gremio.trash_move',$1,true)",[String(bin.id)]);await client.query("update board_templates set deleted_at=(select deleted_at from trash_entries where id=$1) where id=$2",[bin.id,template]);await client.query('COMMIT');}finally{client.release();}
  const tables=['users','boards','board_statuses','cards','attachments','board_templates','trash_entries'];const snapshot=()=>Promise.all(tables.map(async table=>[table,(await pool.query(`select * from ${table} order by id`)).rows] as const));
  const before=await snapshot();
  // Later retention upgrades extend only the pending entry's deadline.
  for(const [table,rows] of before)if(table==='trash_entries')for(const row of rows)if(row.state==='trashed')row.expires_at=new Date(new Date(row.deleted_at).getTime()+30*86400000);
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual(await snapshot(),before);await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual(await snapshot(),before);
  await assert.rejects(pool.query("delete from attachments where card_id=$1",[card]));
  const kinds=(await pool.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conname='trash_entries_kind_check'")).rows[0].definition;assert.match(kinds,/attachment/);
 }finally{await pool.end();await rm(temporary,{recursive:true,force:true});}
});
