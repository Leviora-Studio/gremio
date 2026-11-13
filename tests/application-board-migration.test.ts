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

test("application-board upgrade preserves complete existing cards, accounting positions and settings", { skip: !process.env.TEST_APPLICATION_BOARD_MIGRATION_DATABASE_URL }, async () => {
  const url = process.env.TEST_APPLICATION_BOARD_MIGRATION_DATABASE_URL!;
  assert.match(new URL(url).pathname, /^\/gremio_workflows_test_/);
  const pool = new Pool({ connectionString: url });
  const temporary = await mkdtemp(join(tmpdir(), "gremio-budget-plan-upgrade-"));
  try {
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count, "0", "requires an empty isolated database");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 93);
    await mkdir(join(temporary, "meta"));
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const owner = (await pool.query("insert into users(username) values ('upgrade-owner') returning id")).rows[0].id;
    const account = (await pool.query("insert into accounts(name) values ('Original account') returning id")).rows[0].id;
    const board = (await pool.query("insert into boards(name,owner_id,default_account_id) values ('Original board',$1,$2) returning id", [owner, account])).rows[0].id;
    const status = (await pool.query("insert into board_statuses(board_id,name) values ($1,'Original status') returning id", [board])).rows[0].id;
    await pool.query("insert into board_card_fields(board_id,field_key,visible) values ($1,'budget_title',true)", [board]);
    await pool.query("insert into cards(board_id,status_id,title,applicant,token,budget_title,account_id,requested_amount,approved_amount,actual_amount) values ($1,$2,'Single','Original','upgrade-single','1200',$3,12345,10000,0)", [board, status, account]);
    const card = (await pool.query("insert into cards(board_id,status_id,title,applicant,token,budget_mode,budget_revision,requested_amount,approved_amount) values ($1,$2,'Multiple','Original','upgrade-multi','positions',7,30000,20000) returning id", [board, status])).rows[0].id;
    await pool.query("insert into card_budget_positions(id,card_id,position,budget_title,description,account_id,requested_amount,approved_amount,actual_amount) values ('upgrade-one',$1,0,'1200','Original A',$2,10000,10000,null),('upgrade-two',$1,1,'1300','Original B',$2,20000,10000,0)", [card, account]);
    const tables = ["cards", "card_budget_positions", "board_card_fields", "board_statuses", "accounts"];
    const before = new Map<string, unknown>();
    for (const table of tables) before.set(table, (await pool.query(`select * from ${table} t order by to_jsonb(t)::text`)).rows);
    const originalBoard = (await pool.query("select * from boards where id=$1", [board])).rows[0];
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    for (const table of tables) assert.deepEqual((await pool.query(`select * from ${table} t order by to_jsonb(t)::text`)).rows, before.get(table), `${table} unchanged`);
    const upgradedBoard = (await pool.query("select * from boards where id=$1", [board])).rows[0];
    assert.equal(upgradedBoard.is_application_board, false);
    delete upgradedBoard.is_application_board;
    assert.deepEqual(upgradedBoard, originalBoard);
    assert.deepEqual((await pool.query("select * from card_budget_plans")).rows, []);
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.deepEqual((await pool.query("select * from cards order by id")).rows, before.get("cards"), "repeated migration preserves data");
  } finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
});
