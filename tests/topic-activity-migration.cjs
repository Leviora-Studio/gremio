// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Explicit empty-database upgrade check; not part of ordinary npm test.
const {Pool}=require('pg'),{readMigrationFiles}=require('drizzle-orm/migrator'),assert=require('node:assert/strict');
(async()=>{const url=process.env.TEST_ACTIVITY_MIGRATION_DATABASE_URL;assert.match(new URL(url).pathname,/^\/gremio_workflows_upgrade_test_activity/);const pool=new Pool({connectionString:url});try{
 assert.equal((await pool.query("select tablename from pg_tables where schemaname='public'")).rowCount,0,'never alter a populated database');
 const migrations=readMigrationFiles({migrationsFolder:'drizzle'});const index=migrations.findIndex(m=>m.sql.some(sql=>sql.includes('CREATE TABLE "meeting_topic_activity"')));assert.ok(index>0);
 for(const m of migrations.slice(0,index))for(const sql of m.sql)await pool.query(sql);
 const owner=(await pool.query("insert into users(username) values ('activity-upgrade') returning id")).rows[0].id;const area=(await pool.query("insert into meeting_areas(name,owner_id) values ('Activity upgrade',$1) returning id",[owner])).rows[0].id;const meeting=(await pool.query("insert into meetings(area_id,owner_id,title) values ($1,$2,'Existing meeting') returning id",[area,owner])).rows[0].id;
 const copier=(await pool.query("insert into users(username) values ('old-copying-planner') returning id")).rows[0].id;
 const root=(await pool.query("insert into meeting_topics(created_by,title) values ($1,'Private topic') returning id",[owner])).rows[0].id;const child=(await pool.query("insert into meeting_topics(meeting_id,origin_topic_id,created_by,title,state,created_at) values ($1,$2,$3,'Existing occurrence','deferred','2026-01-01') returning id",[meeting,root,copier])).rows[0].id;
 await pool.query('update meeting_topics set previous_topic_id=$1 where id=$2',[root,child]);
 for(const m of migrations.slice(index))for(const sql of m.sql)await pool.query(sql);
 assert.equal((await pool.query('select created_by from meeting_topics where id=$1',[child])).rows[0].created_by,owner,'original author is restored from the predecessor chain');
 const events=async()=>(await pool.query('select * from meeting_topic_activity where origin_topic_id=$1 order by id',[root])).rows;
 let rows=await events();assert.equal(rows.length,1);assert.equal(rows[0].state,'deferred');assert.equal(rows[0].baseline,true,'only the known state is imported, no fabricated past steps');
 await pool.query("update meeting_topics set state='scheduled' where id=$1",[child]);rows=await events();assert.equal(rows.length,2);assert.equal(rows[0].state,'deferred');assert.equal(rows[1].state,'scheduled');assert.equal(rows[1].baseline,false);
 await pool.query("update meeting_topics set title='Renamed' where id=$1",[child]);await pool.query("update meeting_topics set state='scheduled' where id=$1",[child]);assert.equal((await events()).length,2,'content edits and no-op states add no status activity');
 await pool.query('begin');await pool.query("update meeting_topics set state='withdrawn' where id=$1",[child]);await pool.query('rollback');assert.equal((await events()).length,2,'activity rolls back with the state update');
 console.log(JSON.stringify({passed:true,knownStateBaseline:true,noFabricatedHistory:true,appendOnlyStates:true,noOpSilent:true,rollbackSafe:true}));
 }finally{await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1;});
