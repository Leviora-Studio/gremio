import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

test("upgrade preserves data through workflow migrations and removes only the retired minutes tables", async (t) => {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) return t.skip("Set TEST_MIGRATION_DATABASE_URL to a dedicated empty test database.");
  if (!/^gremio_workflows_upgrade_test_/.test(new URL(url).pathname.slice(1))) throw new Error("Migration test requires an explicitly named isolated database.");
  const pool = new Pool({ connectionString: url });
  try {
    const tables = await pool.query("select tablename from pg_tables where schemaname = 'public'");
    assert.equal(tables.rowCount, 0, "never modify a nonempty database");
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    const budgetMigration = migrations.findIndex((migration) =>
      migration.sql.some((sql) => sql.includes('CREATE TABLE "card_budget_positions"')),
    );
    const instructionMigration = migrations.findIndex((migration) =>
      migration.sql.some((sql) => sql.includes('CREATE TABLE "board_instruction_forms"')),
    );
    assert.ok(budgetMigration > 0, "budget migration must be present");
    assert.ok(
      instructionMigration > budgetMigration,
      "instruction-form migration must follow the budget migration",
    );
    for (const migration of migrations.slice(0, budgetMigration)) {
      for (const sql of migration.sql) await pool.query(sql);
    }
    const owner = (await pool.query("insert into users(username) values ('migration-test') returning id")).rows[0].id;
    const board = (await pool.query("insert into boards(name,owner_id) values ('Migration', $1) returning id", [owner])).rows[0].id;
    const statuses = (await pool.query("insert into board_statuses(board_id,name,is_archive_trigger) values ($1,'Source',false),($1,'Target',true),($1,'Archive 2',true) returning id", [board])).rows;
    await pool.query("update boards set receipt_from_status_id=$1,receipt_to_status_id=$2 where id=$3", [statuses[0].id, statuses[1].id, board]);
    const account = (await pool.query("insert into accounts(name) values ('Account') returning id")).rows[0].id;
    const card = (await pool.query("insert into cards(board_id,status_id,title,applicant,token,budget_title,account_id,requested_amount,approved_amount,actual_amount) values ($1,$2,'Existing','Test','migration-only-token','12345',$3,20000,0,null) returning *", [board, statuses[0].id, account])).rows[0];
    const file = (await pool.query("insert into attachments(card_id,kind,filename,path,mime,size) values ($1,'other','Existing.pdf','test-only','application/pdf',1) returning *", [card.id])).rows[0];
    for (const sql of migrations[budgetMigration].sql) await pool.query(sql);
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
    for (const migration of migrations.slice(budgetMigration + 1)) {
      const removesMinutes = migration.sql.some((sql) => sql.includes('DROP TABLE "protocol_areas"'));
      if (removesMinutes) await seedRetiredMinutes(pool, owner, board, card.id);
      const before = removesMinutes ? await snapshotRetainedData(pool) : null;
      for (const sql of migration.sql) await pool.query(sql);
      if (before) {
        assert.deepEqual(await snapshotRetainedData(pool), before, "removing minutes must preserve every other row and constraint");
        assert.equal((await pool.query("select tablename from pg_tables where schemaname='public' and tablename like 'protocol\\_%' escape '\\'")).rowCount, 0);
      }
    }
    await pool.query("insert into board_instruction_forms(board_id,enabled,filename,path,size,uploaded_by) values ($1,true,'Template.pdf','test-only-template',1,$2)", [board, owner]);
    const instruction = (await pool.query("select * from board_instruction_forms where board_id=$1", [board])).rows[0];
    assert.equal(instruction.filename, "Template.pdf");
    assert.equal(instruction.enabled, true);
    assert.equal((await pool.query("select token from cards where id=$1", [card.id])).rows[0].token, "migration-only-token");
  } finally { await pool.end(); }
});

async function seedRetiredMinutes(pool: Pool, owner: number, board: number, card: number) {
  const template = (await pool.query("insert into protocol_templates(name,markdown) values ('Retired template','# Minutes') returning id")).rows[0].id;
  const area = (await pool.query("insert into protocol_areas(name,owner_id,nc_url,nc_username,nc_password_enc,root_path,template_id,board_id) values ('Retired area',$1,'https://example.invalid','test-only','not-a-credential','/synthetic-minutes',$2,$3) returning id", [owner, template, board])).rows[0].id;
  await pool.query("insert into protocol_area_access(area_id,user_id) values ($1,$2)", [area, owner]);
  const session = (await pool.query("insert into protocol_sessions(area_id,folder_name,protocol_path) values ($1,'Test meeting','/synthetic-minutes/Test meeting/Minutes.md') returning id", [area])).rows[0].id;
  const member = (await pool.query("insert into protocol_members(area_id,name) values ($1,'Test member') returning id", [area])).rows[0].id;
  await pool.query("insert into protocol_attendance(session_id,member_id,present) values ($1,$2,true)", [session, member]);
  await pool.query("insert into protocol_guests(session_id,name) values ($1,'Test guest')", [session]);
  await pool.query("insert into protocol_logos(area_id,name,png_base64) values ($1,'Test logo','dGVzdA==')", [area]);
  await pool.query("insert into protocol_card_links(session_id,card_id,top,last_auto_decision_ref) values ($1,$2,'1','Test meeting-TOP-1')", [session, card]);
  await pool.query("update cards set decision_ref='Retained decision reference' where id=$1", [card]);
  await pool.query("insert into user_task_prefs(user_id,config) values ($1,$2)", [owner, JSON.stringify({ home: { protocols: true, tasks: false, order: ['protocols', 'boards', 'tasks'] } })]);
  await pool.query("insert into finance_boards(name,owner_id) values ('Retained finance board',$1)", [owner]);
  await pool.query("insert into inventory_boards(name,owner_id) values ('Retained inventory board',$1)", [owner]);
  await pool.query("insert into mcp_clients(id,name,redirect_uris) values ('migration-client','Retained client','[\"https://example.invalid/callback\"]')");
  await pool.query("insert into mcp_grants(id,client_id,user_id,scope) values ('migration-grant','migration-client',$1,'read')", [owner]);
  await pool.query("insert into mcp_grant_boards(grant_id,board_id) values ('migration-grant',$1)", [board]);
}

async function snapshotRetainedData(pool: Pool) {
  const tables = (await pool.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows
    .map((row: { tablename: string }) => row.tablename).filter((name: string) => !name.startsWith("protocol_"));
  const rows: Record<string, unknown[]> = {};
  for (const table of tables) {
    const identifier = `"${table.replaceAll('"', '""')}"`;
    rows[table] = (await pool.query(`select to_jsonb(t) as value from ${identifier} t order by to_jsonb(t)::text`)).rows;
  }
  const constraints = (await pool.query("select c.conname, c.contype, r.relname, pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname='public' and r.relname=any($1) order by r.relname,c.conname", [tables])).rows;
  return { rows, constraints };
}
