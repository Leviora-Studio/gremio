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
test("planning upgrade retains frozen data and legacy fields and adds only the resolved account",{skip:!process.env.TEST_PLANNING_UPGRADE_URL},async()=>{
 const url=process.env.TEST_PLANNING_UPGRADE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:url}),folder=await mkdtemp(join(tmpdir(),"gremio-planning-upgrade-"));
 try{
  assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<99);await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)await copyFile(`drizzle/${entry.tag}.sql`,join(folder,`${entry.tag}.sql`));await migrate(drizzle(pool),{migrationsFolder:folder});
  const owner=(await pool.query("insert into users(username) values ('upgrade-owner') returning id")).rows[0].id;
  const account=(await pool.query("insert into accounts(name) values ('Original account') returning id")).rows[0].id;
  const other=(await pool.query("insert into accounts(name) values ('Board default') returning id")).rows[0].id;
  const board=(await pool.query("insert into boards(name,owner_id,is_application_board,default_account_id) values ('Legacy',$1,true,$2) returning id",[owner,other])).rows[0].id;
  const status=(await pool.query("insert into board_statuses(board_id,name,is_lock_column) values ($1,'Accepted',true) returning id",[board])).rows[0].id;
  await pool.query("insert into board_card_fields(board_id,field_key,visible) values ($1,'account',true),($1,'approved_amount',true)",[board]);
  const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token,account_id,approved_amount) values ($1,$2,'Original','Applicant','synthetic-upgrade',$3,5000) returning id",[board,status,account])).rows[0].id;
  const allocations=[{amount:3000,budgetTitle:'1200'},{amount:2000,budgetTitle:'1300',accountId:other}];
  await pool.query('insert into card_budget_plans(card_id,allocations,revision) values ($1,$2,7)',[card,JSON.stringify(allocations)]);
  await pool.query('update cards set locked_at=now(),locked_by=$1 where id=$2',[owner,card]);
  const before=(await pool.query('select * from cards where id=$1',[card])).rows[0];
  await migrate(drizzle(pool),{migrationsFolder:'drizzle'});
  assert.deepEqual((await pool.query('select * from cards where id=$1',[card])).rows[0],before);
  const plan=(await pool.query('select * from card_budget_plans where card_id=$1',[card])).rows[0];assert.equal(plan.revision,7);assert.deepEqual(plan.allocations,[{...allocations[0],accountId:account},allocations[1]]);
  assert.equal((await pool.query('select legacy_finance_fields from boards where id=$1',[board])).rows[0].legacy_finance_fields,true);
  assert.equal((await pool.query('select count(*) from board_card_fields where board_id=$1 and visible',[board])).rows[0].count,'2');
  await pool.query("update board_card_fields set visible=false where board_id=$1 and field_key='account'",[board]);await pool.query("update board_card_fields set visible=true where board_id=$1 and field_key='account'",[board]);
  await assert.rejects(pool.query("update card_budget_plans set allocations='[]',revision=8 where card_id=$1",[card]));
  const fresh=(await pool.query("insert into boards(name,owner_id) values ('New',$1) returning id,legacy_finance_fields",[owner])).rows[0];assert.equal(fresh.legacy_finance_fields,false);
  await assert.rejects(pool.query("insert into board_card_fields(board_id,field_key,visible) values ($1,'approved_amount',true)",[fresh.id]));
 }finally{await pool.end();await rm(folder,{recursive:true,force:true});}
});
