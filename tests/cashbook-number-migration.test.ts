// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Pool} from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {migrate} from "drizzle-orm/node-postgres/migrator";
test("booking-number, emergency-flag and resolution upgrades preserve posted values, fills historical numbers and allocates concurrently",{skip:!process.env.TEST_CASHBOOK_NUMBER_MIGRATION_URL},async()=>{
 const url=process.env.TEST_CASHBOOK_NUMBER_MIGRATION_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_test_/);const pool=new Pool({connectionString:url}),folder=await mkdtemp(join(tmpdir(),"gremio-booking-number-migration-"));
 try{
 assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
 const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<96);await mkdir(join(folder,"meta"));await writeFile(join(folder,"meta/_journal.json"),JSON.stringify(journal));for(const e of journal.entries)await copyFile(`drizzle/${e.tag}.sql`,join(folder,`${e.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:folder});
 const owner=(await pool.query("insert into users(username,role) values ('number-upgrade-owner','admin') returning id")).rows[0].id;
 const config={speakerId:null,financeId:null,officeId:null,numbering:{prefix:"G",year:"",code:"",separator:"_",padding:3},sourceBoardIds:[],templatePath:null,mapping:{},purposeTemplate:"{{number}}"};
 const book=(await pool.query("insert into cashbooks(name,owner_id,config) values ('Number upgrade',$1,$2) returning id",[owner,config])).rows[0].id;
 const payment={business:true,cardId:null,receiptIds:[],number:"G001",amount:12345,budgetTitle:"1200",holder:"Original",iban:"DE89370400440532013000",bank:"Original bank",purpose:"Original purpose",place:"Köthen",date:"2026-11-13"};
 const original=(await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,data,role,authorized_at) values ($1,$2,'posted',$3,'speaker','2026-11-12T12:00:00Z') returning id",[book,owner,payment])).rows[0].id;
 await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,data,role,authorized_at,corrects_id,correction_reason) values ($1,$2,'posted',$3,'speaker','2026-11-13T12:00:00Z',$4,'Original reason')",[book,owner,{...payment,amount:11000},original]);
 await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,data,role) values ($1,$2,'draft',$3,'speaker')",[book,owner,payment]);
 const before=(await pool.query("select * from cashbook_entries order by id")).rows;
 const through97=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));through97.entries=through97.entries.filter((e:{idx:number})=>e.idx<=97);await writeFile(join(folder,"meta/_journal.json"),JSON.stringify(through97));for(const e of through97.entries)await copyFile(`drizzle/${e.tag}.sql`,join(folder,`${e.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:folder});
 const after=(await pool.query("select * from cashbook_entries order by id")).rows;assert.deepEqual(after.map(({booking_number,flagged_at,flagged_by,flag_reason,...row})=>row),before);assert.deepEqual(after.map(row=>row.booking_number),["B-0001","B-0002",null]);assert.ok(after.every(row=>row.flagged_at===null&&row.flagged_by===null&&row.flag_reason===null));
 await pool.query("update cashbook_entries set flagged_at=now(),flagged_by=$1,flag_reason='Existing warning' where id=$2",[owner,original]);
 const beforeResolutionUpgrade=(await pool.query("select * from cashbook_entries order by id")).rows;
 await migrate(drizzle(pool),{migrationsFolder:"drizzle"});
 const afterResolutionUpgrade=(await pool.query("select * from cashbook_entries order by id")).rows;
 assert.deepEqual(afterResolutionUpgrade.map(({flag_resolved_at,flag_resolved_by,...row})=>row),beforeResolutionUpgrade);
 assert.ok(afterResolutionUpgrade.every(row=>row.flag_resolved_at===null&&row.flag_resolved_by===null));
 assert.equal(afterResolutionUpgrade[0].flag_reason,"Existing warning");
 await pool.query("update cashbooks set config=jsonb_set(config,'{bookingNumbering}',$1) where id=$2",[{prefix:"KÖT",digits:4},book]);
 const inserted=await Promise.all(Array.from({length:5},()=>pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,data,role,authorized_at) values ($1,$2,'posted',$3,'speaker',now()) returning booking_number",[book,owner,payment])));
 assert.deepEqual(inserted.map(r=>r.rows[0].booking_number).sort(),["KÖT-0003","KÖT-0004","KÖT-0005","KÖT-0006","KÖT-0007"]);
 assert.equal((await pool.query("select booking_number from cashbook_entries where id=$1",[original])).rows[0].booking_number,"B-0001");
 await assert.rejects(pool.query("update cashbook_entries set booking_number='changed' where id=$1",[original]));
 }finally{await pool.end();await rm(folder,{recursive:true,force:true});}
});
