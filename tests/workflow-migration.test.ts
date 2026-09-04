import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

test("upgrade preserves single-card values, tokens, files and receipt/archive triggers", async (t) => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) return t.skip("Set TEST_MIGRATION_DATABASE_URL to a dedicated empty test database.");
  if (!/^gremio_workflows_upgrade_test_/.test(new URL(url).pathname.slice(1))) throw new Error("Migration test requires an explicitly named isolated database.");
  const pool = new Pool({ connectionString: url });
  try {
    const tables = await pool.query("select tablename from pg_tables where schemaname = 'public'");
    assert.equal(tables.rowCount, 0, "never modify a nonempty database");
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    for (const migration of migrations.slice(0, -1)) for (const sql of migration.sql) await pool.query(sql);
    const owner = (await pool.query("insert into users(username) values ('migration-test') returning id")).rows[0].id;
    const board = (await pool.query("insert into boards(name,owner_id) values ('Migration', $1) returning id", [owner])).rows[0].id;
    const statuses = (await pool.query("insert into board_statuses(board_id,name,is_archive_trigger) values ($1,'Source',false),($1,'Target',true),($1,'Archive 2',true) returning id", [board])).rows;
    await pool.query("update boards set receipt_from_status_id=$1,receipt_to_status_id=$2 where id=$3", [statuses[0].id, statuses[1].id, board]);
    const account = (await pool.query("insert into accounts(name) values ('Account') returning id")).rows[0].id;
    const card = (await pool.query("insert into cards(board_id,status_id,title,applicant,token,budget_title,account_id,requested_amount,approved_amount,actual_amount) values ($1,$2,'Existing','Test','migration-only-token','12345',$3,20000,0,null) returning *", [board, statuses[0].id, account])).rows[0];
    const file = (await pool.query("insert into attachments(card_id,kind,filename,path,mime,size) values ($1,'other','Existing.pdf','test-only','application/pdf',1) returning *", [card.id])).rows[0];
    for (const sql of migrations.at(-1)!.sql) await pool.query(sql);
    const updated = (await pool.query("select * from cards where id=$1", [card.id])).rows[0];
    assert.equal(updated.budget_mode, "single"); assert.equal(updated.budget_revision, 0);
    delete updated.budget_mode; delete updated.budget_revision;
    assert.deepEqual(updated, card);
    const attachment = (await pool.query("select * from attachments where id=$1", [file.id])).rows[0];
    assert.equal(attachment.upload_purpose, null); delete attachment.upload_purpose; assert.deepEqual(attachment, file);
    const flags = (await pool.query("select * from board_statuses where board_id=$1 order by id", [board])).rows;
    assert.deepEqual(flags.map(s => s.is_receipt_trigger), [true,false,false]);
    assert.deepEqual(flags.map(s => s.is_archive_trigger), [false,true,true]);
    assert.equal((await pool.query("select receipt_to_status_id from boards where id=$1", [board])).rows[0].receipt_to_status_id, statuses[1].id);
    const template = (await pool.query("insert into board_templates(name) values ('Template') returning id")).rows[0].id;
    await pool.query("insert into board_template_statuses(template_id,name,is_archive_trigger) values ($1,'A',true),($1,'B',true),($1,'C',true)", [template]);
    assert.equal((await pool.query("select * from card_budget_positions")).rowCount, 0);
  } finally { await pool.end(); }
});
