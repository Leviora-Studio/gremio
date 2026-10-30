// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

test("access-level upgrade preserves every legacy person/group grant as read-write", async t => {
  const url = process.env.TEST_ACCESS_MIGRATION_DATABASE_URL;
  if (!url) return t.skip("Set TEST_ACCESS_MIGRATION_DATABASE_URL to an empty isolated database.");
  assert.match(new URL(url).pathname, /^\/gremio_workflows_upgrade_test_/);
  const pool = new Pool({ connectionString: url });
  try {
    assert.equal((await pool.query("select * from pg_tables where schemaname='public'")).rowCount, 0);
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    const index = migrations.findIndex(m => m.sql.some(sql => sql.includes('ADD COLUMN "access_level"')));
    assert.ok(index > 0);
    for (const migration of migrations.slice(0, index)) for (const sql of migration.sql) await pool.query(sql);
    const owner = (await pool.query("insert into users(username) values ('access-upgrade-owner') returning id")).rows[0].id;
    const member = (await pool.query("insert into users(username) values ('access-upgrade-member') returning id")).rows[0].id;
    const group = (await pool.query("insert into groups(name) values ('access-upgrade-group') returning id")).rows[0].id;
    for (const [boardTable, accessTable, key] of [["boards", "board_access", "board_id"], ["finance_boards", "finance_board_access", "finance_board_id"], ["inventory_boards", "inventory_board_access", "board_id"]]) {
      const board = (await pool.query(`insert into ${boardTable}(name,owner_id) values ('Existing', $1) returning id`, [owner])).rows[0].id;
      await pool.query(`insert into ${accessTable}(${key}, user_id, group_id) values ($1,$2,null),($1,null,$3)`, [board, member, group]);
    }
    const tables = ["board_access", "finance_board_access", "inventory_board_access"];
    const before = await Promise.all(tables.map(table => pool.query(`select * from ${table} order by id`)));
    for (const migration of migrations.slice(index)) for (const sql of migration.sql) await pool.query(sql);
    for (const [i, table] of tables.entries()) {
      const rows = (await pool.query(`select * from ${table} order by id`)).rows;
      assert.deepEqual(rows, before[i].rows.map(row => ({ ...row, access_level: "write" })));
      await pool.query(`update ${table} set access_level='read' where user_id is not null`);
      await assert.rejects(pool.query(`update ${table} set access_level='admin'`), (error: unknown) => (error as { code: string }).code === "23514");
    }
  } finally { await pool.end(); }
});
