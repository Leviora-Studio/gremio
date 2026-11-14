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

test("new-board finance-field cleanup preserves legacy fields, card values and frozen plans",{skip:!process.env.TEST_BOARD_FIELDS_UPGRADE_URL},async()=>{
 const url=process.env.TEST_BOARD_FIELDS_UPGRADE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:url}),folder=await mkdtemp(join(tmpdir(),"gremio-field-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<100);
  await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)await copyFile(`drizzle/${entry.tag}.sql`,join(folder,`${entry.tag}.sql`));
  await migrate(drizzle(pool),{migrationsFolder:folder});
  const owner=(await pool.query("insert into users(username) values ('field-upgrade-owner') returning id")).rows[0].id;
  const account=(await pool.query("insert into accounts(name) values ('Retained account') returning id")).rows[0].id;
  const oldBoard=(await pool.query("insert into boards(name,owner_id,legacy_finance_fields) values ('Legacy',$1,true) returning id",[owner])).rows[0].id;
  const newBoard=(await pool.query("insert into boards(name,owner_id) values ('New',$1) returning id",[owner])).rows[0].id;
  await pool.query("insert into board_card_fields(board_id,field_key,visible) values ($1,'account',true),($1,'budget_title',true),($1,'approved_amount',false),($2,'budget_title',true),($2,'notes',true)",[oldBoard,newBoard]);
  for(const boardId of [oldBoard,newBoard]){
   const status=(await pool.query("insert into board_statuses(board_id,name) values ($1,'Accepted') returning id",[boardId])).rows[0].id;
   const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token,account_id,budget_title,approved_amount) values ($1,$2,'Preserved','Applicant',$3,$4,'Historical title',5000) returning id",[boardId,status,'field-upgrade-'+boardId,account])).rows[0].id;
   await pool.query('insert into card_budget_plans(card_id,allocations,revision) values ($1,$2,7)',[card,JSON.stringify([{amount:5000,budgetTitle:'1200',accountId:account}])]);
   await pool.query('update cards set locked_at=now(),locked_by=$1 where id=$2',[owner,card]);
  }
  const beforeCards=(await pool.query('select * from cards order by id')).rows,beforePlans=(await pool.query('select * from card_budget_plans order by card_id')).rows;
  const oldFields=(await pool.query('select * from board_card_fields where board_id=$1 order by field_key',[oldBoard])).rows;
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});
  assert.deepEqual((await pool.query('select * from cards order by id')).rows,beforeCards);
  assert.deepEqual((await pool.query('select * from card_budget_plans order by card_id')).rows,beforePlans);
  assert.deepEqual((await pool.query('select * from board_card_fields where board_id=$1 order by field_key',[oldBoard])).rows,oldFields);
  assert.deepEqual((await pool.query('select field_key from board_card_fields where board_id=$1',[newBoard])).rows,[{field_key:'notes'}]);
  for(const key of ['account','budget_title','approved_amount'])await assert.rejects(pool.query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)',[newBoard,key]));
  await assert.rejects(pool.query("update board_card_fields set field_key='budget_title' where board_id=$1",[newBoard]));
  await pool.query("update board_card_fields set visible=true where board_id=$1 and field_key='approved_amount'",[oldBoard]);
 }finally{await pool.end();await rm(folder,{recursive:true,force:true});}
});
