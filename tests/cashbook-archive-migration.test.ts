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
import { defaultCashbookConfig } from "../lib/cashbook-types";
test("cashbook archive upgrade preserves existing books, posted corrections and files and leaves archiving disabled",{skip:!process.env.TEST_CASHBOOK_ARCHIVE_MIGRATION_DATABASE_URL},async()=>{
 const url=process.env.TEST_CASHBOOK_ARCHIVE_MIGRATION_DATABASE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
 const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-book-archive-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<110);await mkdir(join(temporary,'meta'));await writeFile(join(temporary,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(temporary,`${e.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:temporary});
  const [owner,second]=(await pool.query("insert into users(username) values('archive-upgrade-owner'),('archive-upgrade-second') returning id")).rows;
  const book=(await pool.query("insert into cashbooks(name,owner_id,config) values('Original book',$1,$2) returning id",[owner.id,JSON.stringify(defaultCashbookConfig)])).rows[0].id;
  const data={cardId:null,business:true,number:'G-Original',receiptIds:[],amount:1234,budgetTitle:'1200',holder:'Original',iban:'DE89370400440532013000',bank:'Original bank',purpose:'Original purpose',place:'',date:''};const files=[{id:'original',filename:'Signed.pdf',path:'original/never-read.pdf',sha256:'original-checksum',mime:'application/pdf',kind:'signed'}];
  const original=(await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,role,authorized_at,data,files) values($1,$2,'posted','speaker',now(),$3,$4) returning id",[book,owner.id,JSON.stringify(data),JSON.stringify(files)])).rows[0].id;
  await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,role,authorized_at,data,files,corrects_id,correction_reason) values($1,$2,'posted','speaker',now(),$3,$4,$5,'Original reason')",[book,owner.id,JSON.stringify({...data,amount:999}),JSON.stringify(files),original]);
  await pool.query("insert into cashbook_activity(cashbook_id,entry_id,user_id,type,detail) values($1,$2,$3,'created','{}')",[book,original,owner.id]);
  const tables=['users','cashbooks','cashbook_entries','cashbook_activity'];const snapshot=()=>Promise.all(tables.map(async table=>[table,(await pool.query(`select * from ${table} order by id`)).rows]));const before=await snapshot();await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual(await snapshot(),before);assert.equal((await pool.query('select count(*) from cashbook_archive')).rows[0].count,'0');assert.equal((await pool.query('select count(*) from cashbook_archive_jobs')).rows[0].count,'0');await migrate(drizzle(pool),{migrationsFolder:'drizzle'});assert.deepEqual(await snapshot(),before);
  await pool.query("insert into cashbook_archive(cashbook_id,enabled,nc_url,nc_username,nc_password_enc,target_folder) values($1,true,'https://synthetic.invalid','synthetic','never-decrypted','/archive')",[book]);assert.equal((await pool.query('select count(*) from cashbook_archive_jobs')).rows[0].count,'0');
  const submitted=(await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,role,second_signer_id,first_signed_at,second_signed_at,data,files) values($1,$2,'submitted','speaker',$3,now(),now(),$4,$5) returning id",[book,owner.id,second.id,JSON.stringify(data),JSON.stringify(files)])).rows[0].id;
  await pool.query("update cashbook_entries set state='posted',authorized_at=now() where id=$1",[submitted]);assert.equal((await pool.query('select entry_id from cashbook_archive_jobs where entry_id=$1',[submitted])).rowCount,1);await assert.rejects(pool.query("update cashbook_entries set data='{}' where id=$1",[submitted]));
 }finally{await pool.end();await rm(temporary,{recursive:true,force:true});}
});
