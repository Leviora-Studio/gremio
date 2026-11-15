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

test("recycle-bin upgrade preserves all existing rows, locks, grants and posted bookings", { skip: !process.env.TEST_TRASH_MIGRATION_DATABASE_URL }, async () => {
  const url=process.env.TEST_TRASH_MIGRATION_DATABASE_URL!;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
  const pool=new Pool({connectionString:url}),temporary=await mkdtemp(join(tmpdir(),"gremio-trash-upgrade-"));
  try{
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count,"0");
    const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<106);
    await mkdir(join(temporary,"meta"));await writeFile(join(temporary,"meta/_journal.json"),JSON.stringify(journal));
    for(const entry of journal.entries)await copyFile(`drizzle/${entry.tag}.sql`,join(temporary,`${entry.tag}.sql`));
    await migrate(drizzle(pool),{migrationsFolder:temporary});
    const owner=(await pool.query("insert into users(username) values ('catalog-upgrade-owner') returning id")).rows[0].id;
    const account=(await pool.query("insert into accounts(name) values ('Original account') returning id")).rows[0].id;
    const board=(await pool.query("insert into boards(name,owner_id,is_application_board) values ('Original application board',$1,true) returning id",[owner])).rows[0].id;
    const status=(await pool.query("insert into board_statuses(board_id,name,is_lock_column) values ($1,'Accepted',true) returning id",[board])).rows[0].id;
    const card=(await pool.query("insert into cards(board_id,status_id,title,applicant,token) values ($1,$2,'Original','Synthetic','catalog-upgrade') returning id",[board,status])).rows[0].id;
    await pool.query("insert into card_budget_plans(card_id,allocations,revision) values ($1,$2,7)",[card,JSON.stringify([{amount:12345,budgetTitle:"Historical title",accountId:account}])]);
    await pool.query("update cards set locked_at=now(),locked_by=$1 where id=$2",[owner,card]);
    const book=(await pool.query("insert into cashbooks(name,owner_id,config) values ('Original book',$1,$2) returning id",[owner,JSON.stringify(defaultCashbookConfig)])).rows[0].id;
    await pool.query("insert into cashbook_entries(cashbook_id,creator_id,state,role,authorized_at,data) values ($1,$2,'posted','speaker',now(),$3)",[book,owner,JSON.stringify({cardId:card,business:false,number:"Original number",receiptIds:[],amount:12345,budgetTitle:"Historical title",holder:"Original holder",iban:"DE89370400440532013000",bank:"Original bank",purpose:"Original purpose",place:"",date:""})]);
    const tables=["accounts","cashbooks","cards","card_budget_plans","cashbook_entries"];
    const snapshot=async()=>Promise.all(tables.map(async table=>[table,(await pool.query(`select * from ${table} order by ${table==="card_budget_plans"?"card_id":"id"}`)).rows] as const));
    await pool.query("insert into board_access(board_id,user_id,access_level) values ($1,$2,'write')",[board,owner]);
    const originalGrants=(await pool.query("select * from board_access")).rows;
    const before=await snapshot();await migrate(drizzle(pool),{migrationsFolder:"drizzle"});
    const after=await snapshot();for(const [table,rows] of after)if(["accounts","cashbooks"].includes(table))for(const row of rows){assert.equal(row.deleted_at,null);delete row.deleted_at;}
    assert.deepEqual(after,before,"no stored allocation, lock, booking, balance or settings value is rewritten");
    assert.deepEqual((await pool.query("select * from board_access")).rows,originalGrants);
    await assert.rejects(pool.query("update cards set title='Changed' where id=$1",[card]));
    await assert.rejects(pool.query("delete from cashbook_entries where cashbook_id=$1",[book]));
    assert.equal((await pool.query("select count(*) from trash_entries")).rows[0].count,"0");
    const migrated=await snapshot();await migrate(drizzle(pool),{migrationsFolder:"drizzle"});assert.deepEqual(await snapshot(),migrated);
  }finally{await pool.end();await rm(temporary,{recursive:true,force:true});}
});
