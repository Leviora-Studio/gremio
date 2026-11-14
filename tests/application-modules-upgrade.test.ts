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
test("module upgrade keeps the old public form active and preserves legacy fields, files and stored finance values",{skip:!process.env.TEST_APPLICATION_MODULES_UPGRADE_URL},async()=>{
 const url=process.env.TEST_APPLICATION_MODULES_UPGRADE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:url}),folder=await mkdtemp(join(tmpdir(),"gremio-modules-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<101);
  await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)await copyFile(`drizzle/${entry.tag}.sql`,join(folder,`${entry.tag}.sql`));
  await migrate(drizzle(pool),{migrationsFolder:folder});
  const owner=(await pool.query("insert into users(username,role) values ('modules-upgrade','admin') returning id")).rows[0].id;
  const old=(await pool.query("insert into boards(name,owner_id,legacy_finance_fields,is_application_board) values ('Old',$1,true,true) returning id",[owner])).rows[0].id;
  const recent=(await pool.query("insert into boards(name,owner_id) values ('Recent',$1) returning id",[owner])).rows[0].id;
  for(const id of [old,recent]){
   await pool.query("insert into board_card_fields(board_id,field_key,visible) values ($1,'actual_amount',true),($1,'instruction_date',true),($1,'transfer_date',true),($1,'finance_request',true),($1,'annex_a',true),($1,'student_card',true)",[id]);
   const status=(await pool.query("insert into board_statuses(board_id,name) values ($1,'Inbox') returning id",[id])).rows[0].id;
   const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token,actual_amount,instruction_date,transfer_date) values ($1,$2,'Preserve','Person',$3,4500,'2026-11-13','2026-11-14') returning id",[id,status,`upgrade-${id}`])).rows[0].id;
   await pool.query("insert into attachments(card_id,kind,filename,path,mime,size) values ($1,'finance_request','original.pdf','synthetic-unchanged.pdf','application/pdf',10)",[card]);
   await pool.query("insert into locations(name,enabled,target_board_id,target_status_id) values ($1,true,$2,$3)",[`Campus ${id}`,id,status]);
  }
  const snapshot=async(table:string,order:string)=>(await pool.query(`select * from ${table} order by ${order}`)).rows;
  const cards=await snapshot('cards','id'),files=await snapshot('attachments','id'),locations=await snapshot('locations','id');
  const oldFields=(await pool.query('select * from board_card_fields where board_id=$1 order by field_key',[old])).rows;
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});
  assert.deepEqual(await snapshot('cards','id'),cards);assert.deepEqual(await snapshot('attachments','id'),files);
  assert.deepEqual((await snapshot('locations','id')).map(({module,...row})=>{assert.equal(module,'locations');return row;}),locations);
  assert.deepEqual((await pool.query('select * from board_card_fields where board_id=$1 order by field_key',[old])).rows,oldFields);
  assert.deepEqual((await pool.query('select field_key from board_card_fields where board_id=$1 order by field_key',[recent])).rows.map(row=>row.field_key),['annex_a','finance_request','student_card']);
  assert.deepEqual((await pool.query('select active_module,revision from application_form_modules')).rows,[{active_module:'locations',revision:0}]);
  assert.ok((await pool.query('select attachment_fields from boards')).rows.every(row=>row.attachment_fields===null));
  for(const key of ['actual_amount','instruction_date','transfer_date'])await assert.rejects(pool.query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)',[recent,key]));
 }finally{await pool.end();await rm(folder,{recursive:true,force:true});}
});
