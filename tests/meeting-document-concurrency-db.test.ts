// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { requireMeeting } from "../lib/meetings/access";
import * as service from "../lib/meetings/service";
import { PDFDocument } from "pdf-lib";

after(() => pool.end());

test("document mutations invalidate stale TOP edits and serialize with meeting closure", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  assert.match(process.env.UPLOAD_DIR!, /reaudit|test/);
  const [owner] = await db.insert(s.users).values({ username: randomUUID() }).returning();
  const area = await service.saveArea(owner, null, "Document concurrency", "");
  const meetingId = await service.saveMeeting(owner, null, { areaId: area, title: "Document meeting", startsAt: "", submissionDeadline: "", location: "", chair: "", state: "planning" });
  const values = { title: "Document TOP", description: "", motion: "", presenter: "", kind: "discussion", durationMinutes: 10, confidential: false, state: "scheduled", outcome: "" };
  const topicId = await service.createTopic(owner, meetingId, values);
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const file = () => new File([new Uint8Array(bytes)], "Synthetic.pdf", { type: "application/pdf" });
  const closer = await pool.connect();
  try {
    const before = await requireMeeting(owner, meetingId);
    await service.addMeetingDocument(owner, topicId, file(), true);
    const afterUpload = await requireMeeting(owner, meetingId);
    assert.ok(afterUpload.revision > before.revision, "new disclosed content must invalidate already open TOP forms");
    await assert.rejects(service.saveTopic(owner, topicId, values, before.revision, false), /geändert/);
    const [doc] = await db.select().from(s.meetingDocuments).where(eq(s.meetingDocuments.topicId, topicId));
    await service.removeMeetingDocument(owner, doc.id);
    assert.ok((await requireMeeting(owner, meetingId)).revision > afterUpload.revision);

    // An uncommitted closure is invisible to the first access check. The final
    // write must wait for the meeting lock and then reject the closed state.
    await closer.query("begin");
    await closer.query("update meetings set state='closed', revision=revision+1 where id=$1", [meetingId]);
    let settled = false;
    const upload = service.addMeetingDocument(owner, topicId, file(), true).then(
      () => { settled = true; return { error: null }; },
      error => { settled = true; return { error }; },
    );
    try {
      for (let attempt = 0; attempt < 100 && !settled; attempt++) {
        const waiting = await pool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%update%meetings%' and pid<>pg_backend_pid()");
        if (waiting.rowCount) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally { await closer.query("commit"); }
    assert.match(String((await upload).error), /geändert|abgeschlossen/);
    assert.equal((await db.select().from(s.meetingDocuments).where(eq(s.meetingDocuments.topicId, topicId))).length, 0);
    assert.deepEqual(await readdir(join(process.env.UPLOAD_DIR!, "meeting-topics", String(topicId))), [], "rejected uploads leave no stored files");
  } finally {
    await closer.query("rollback"); closer.release();
    await service.deleteMeeting(owner, meetingId);
    await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id, area));
    await db.delete(s.users).where(eq(s.users.id, owner.id));
  }
});
