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

test("30-day upgrade extends pending resource/file entries from deletion, preserves longer deadlines and leaves completed history/content unchanged", { skip: !process.env.TEST_TRASH_RETENTION_MIGRATION_DATABASE_URL }, async () => {
  const url = process.env.TEST_TRASH_RETENTION_MIGRATION_DATABASE_URL!;
  assert.match(new URL(url).pathname, /^\/gremio_workflows_upgrade_test_/);
  const pool = new Pool({ connectionString: url }), temporary = await mkdtemp(join(tmpdir(), "gremio-retention-upgrade-"));
  try {
    assert.equal((await pool.query("select count(*) from information_schema.tables where table_schema='public'")).rows[0].count, "0");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 108);
    await mkdir(join(temporary, "meta")); await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(temporary, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: temporary });
    const owner = (await pool.query("insert into users(username,role) values('retention-upgrade-owner','admin') returning id")).rows[0].id;
    const board = (await pool.query("insert into boards(name,owner_id,is_application_board) values('Original board',$1,true) returning id", [owner])).rows[0].id;
    const status = (await pool.query("insert into board_statuses(board_id,name) values($1,'Original status') returning id", [board])).rows[0].id;
    await pool.query("insert into cards(board_id,status_id,title,applicant,token,locked_at,locked_by) values($1,$2,'Frozen original','Original person','retention-upgrade',now(),$3)", [board, status, owner]);
    await pool.query("insert into board_access(board_id,user_id,access_level) values($1,$2,'write')", [board, owner]);
    const cases = [
      { kind: "board", state: "trashed", age: 2, days: 5 },
      { kind: "attachment", state: "trashed", age: 10, days: 5 },
      { kind: "cashbook", state: "trashed", age: 40, days: 5 },
      { kind: "inventory", state: "trashed", age: 2, days: 60 },
      { kind: "board", state: "purging", age: 10, days: 5 },
      { kind: "attachment", state: "restored", age: 10, days: 5 },
      { kind: "board", state: "purged", age: 10, days: 5 },
    ];
    for (const [i, value] of cases.entries()) await pool.query("insert into trash_entries(kind,entity_id,label,state,deleted_by,deleted_at,expires_at,context,cleanup_paths) values($1,$2,$3,$4,$5,now()-make_interval(hours=>$6),now()-make_interval(hours=>$6)+make_interval(hours=>$7),$8,$9)", [value.kind, i + 1000, `Original ${i}`, value.state, owner, value.age * 24, value.days * 24, JSON.stringify({ boardId: board, original: "Unchanged snapshot", attachment: { path: `never-read-${i}.pdf` } }), JSON.stringify([`never-read-${i}.pdf`])]);
    const before = (await pool.query("select * from trash_entries order by id")).rows;
    const tables = ["users", "boards", "board_statuses", "cards", "board_access"];
    const content = async () => Promise.all(tables.map(async table => [table, (await pool.query(`select * from ${table}`)).rows]));
    const originalContent = await content();
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const after = (await pool.query("select * from trash_entries order by id")).rows;
    for (const [i, value] of before.entries()) {
      const expected = value.state === "trashed" && cases[i].days < 30 ? new Date(value.deleted_at.getTime() + 30 * 86400000) : value.expires_at;
      assert.equal(after[i].expires_at.getTime(), expected.getTime());
      assert.deepEqual({ ...after[i], expires_at: value.expires_at }, value, "only pending deadlines change");
    }
    assert.ok(after[1].expires_at > new Date(), "a former five-day expiration is recoverable again when its data remains");
    assert.ok(after[2].expires_at < new Date(), "entries older than 30 days do not receive 30 additional days from upgrade");
    assert.deepEqual(await content(), originalContent, "frozen content and grants are preserved");
    await assert.rejects(pool.query("insert into trash_entries(kind,entity_id,label,deleted_at,expires_at) values('board',9999,'Too short',now(),now()+interval '120 hours')"));
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    assert.deepEqual((await pool.query("select * from trash_entries order by id")).rows, after);
  } finally { await pool.end(); await rm(temporary, { recursive: true, force: true }); }
});
