// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
test("meeting areas preserve separate legacy audiences, topics and document paths",async t=>{
  const url=process.env.TEST_MEETING_AREA_MIGRATION_DATABASE_URL;
  if(!url)return t.skip("Set TEST_MEETING_AREA_MIGRATION_DATABASE_URL to an empty isolated DB.");
  assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_/);
  const pool=new Pool({connectionString:url});
  try{
    assert.equal((await pool.query("select * from pg_tables where schemaname='public'")).rowCount,0);
    const migrations=readMigrationFiles({migrationsFolder:"drizzle"});
    const index=migrations.findIndex(m=>m.sql.some(sql=>sql.includes('CREATE TABLE "meeting_areas"')));assert.ok(index>0);
    for(const m of migrations.slice(0,index))for(const sql of m.sql)await pool.query(sql);
    const owner=(await pool.query("insert into users(username) values('area-owner') returning id")).rows[0].id;
    const guest=(await pool.query("insert into users(username) values('area-guest') returning id")).rows[0].id;
    const group=(await pool.query("insert into groups(name) values('area-group') returning id")).rows[0].id;
    const sessions=(await pool.query("insert into meetings(title,committee,owner_id) values('A','Same name',$1),('B','Same name',$1) returning id",[owner])).rows;
    await pool.query("insert into meeting_access(meeting_id,user_id,access_level) values($1,$2,'read')",[sessions[0].id,guest]);
    await pool.query("insert into meeting_access(meeting_id,group_id,access_level) values($1,$2,'write')",[sessions[1].id,group]);
    const topic=(await pool.query("insert into meeting_topics(meeting_id,created_by,title,confidential) values($1,$2,'Retained TOP',true) returning *",[sessions[0].id,owner])).rows[0];
    const doc=(await pool.query("insert into meeting_documents(topic_id,filename,path,mime,size) values($1,'Retained.pdf','synthetic/retained.pdf','application/pdf',10) returning *",[topic.id])).rows[0];
    for(const m of migrations.slice(index))for(const sql of m.sql)await pool.query(sql);
    assert.equal((await pool.query("select * from meeting_areas")).rowCount,2,"equal names never merge audiences");
    const upgraded=(await pool.query("select id,area_id from meetings order by id")).rows;assert.notEqual(upgraded[0].area_id,upgraded[1].area_id);
    const grants=(await pool.query("select area_id,user_id,group_id,access_level from meeting_area_access order by id")).rows;
    assert.deepEqual(grants,[{area_id:upgraded[0].area_id,user_id:guest,group_id:null,access_level:'read'},{area_id:upgraded[1].area_id,user_id:null,group_id:group,access_level:'write'}]);
    // Later migrations add columns; every legacy value must remain unchanged.
    const upgradedTopic=(await pool.query("select * from meeting_topics where id=$1",[topic.id])).rows[0];
    assert.deepEqual(Object.fromEntries(Object.keys(topic).map(key=>[key,upgradedTopic[key]])),topic);
    assert.equal(upgradedTopic.parent_id,null);
    assert.deepEqual((await pool.query("select * from meeting_documents where id=$1",[doc.id])).rows[0],doc);
    const next=(await pool.query("insert into meeting_areas(name,owner_id) values('New',$1) returning id",[owner])).rows[0];assert.ok(next.id>Math.max(...upgraded.map(m=>m.area_id)));
  }finally{await pool.end();}
});
