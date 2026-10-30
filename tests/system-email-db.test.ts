// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db, pool } from "../lib/db";
import { users, boards, boardStatuses, boardEmailRules, smtpSettings, emailConfirmationSettings, emailOutbox, cards, feedbackAreas, locations, inventoryBoards, inventoryItems } from "../lib/db/schema";
import { emailAddressSchema, parseEmailRecipients } from "../lib/email-validation";
import { processEmailQueue, renderEmail } from "../lib/email";
import { submitPublicApplication } from "../lib/public-application-submission";
import { submitPublicFeedback } from "../lib/public-feedback-submission";
import { createLoanRequest } from "../lib/inventory-loans";
import { getApplicationStatusByToken } from "../lib/public-status";
import { computeFeedbackFingerprint } from "../lib/public-api-idempotency";

import { checkEmailSettings } from "./email-settings.fixture";

test("SMTP and receipt settings require admin; column rules require management", checkEmailSettings);

// Deliberately requires an isolated migrated DB. Never run against normal app data.
test("durable private email delivery, all public receipts, rollback, status transitions and retries", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const captured: string[] = [];
  const recipients: string[] = [];
  const server = createServer(socket => {
    let buffer = "", data = false, message = "";
    socket.setEncoding("utf8"); socket.write("220 localhost ESMTP test\r\n");
    socket.on("data", chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") { captured.push(message); message = ""; data = false; socket.write("250 queued\r\n"); }
          else message += line + "\r\n";
        } else if (/^EHLO|^HELO/i.test(line)) socket.write("250-localhost\r\n250 SIZE 2000000\r\n");
        else if (/^RCPT TO/i.test(line)) { recipients.push(line); socket.write("250 ok\r\n"); }
        else if (/^DATA/i.test(line)) { data = true; socket.write("354 send\r\n"); }
        else if (/^QUIT/i.test(line)) { socket.end("221 bye\r\n"); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const suffix = randomUUID();
  let ownerId: number | undefined, boardId: number | undefined, inventoryId: number | undefined;
  try {
    assert.equal(emailAddressSchema.safeParse("a@example.org\r\nBcc: x@example.org").success, false);
    assert.equal(emailAddressSchema.safeParse("").success, false);
    assert.deepEqual(parseEmailRecipients("a@example.org; b@example.org\na@example.org"), ["a@example.org", "b@example.org"]);
    assert.equal(parseEmailRecipients("bad"), null);
    const [owner] = await db.insert(users).values({ username: suffix, role: "admin" }).returning(); ownerId = owner.id;
    const [board] = await db.insert(boards).values({ name: suffix, ownerId }).returning(); boardId = board.id;
    const [first, second] = await db.insert(boardStatuses).values([{ boardId, name: "Incoming" }, { boardId, name: "Done", position: 1 }]).returning();
    const [area] = await db.insert(feedbackAreas).values({ name: suffix, targetBoardId: boardId, targetStatusId: first.id, enabled: true }).returning();
    const [location] = await db.insert(locations).values({ name: suffix, targetBoardId: boardId, targetStatusId: first.id, enabled: true }).returning();
    const [inventory] = await db.insert(inventoryBoards).values({ name: suffix, ownerId, isPublic: true }).returning(); inventoryId = inventory.id;
    const [item] = await db.insert(inventoryItems).values({ boardId: inventoryId, name: "Test item", quantity: 2 }).returning();
    await db.insert(smtpSettings).values({ enabled: false, host: "127.0.0.1", port, security: "none", fromEmail: "system@example.invalid" });
    await db.insert(emailConfirmationSettings).values([{ kind: "feedback", boardId, enabled: true }, { kind: "application", boardId, enabled: true }, { kind: "inventory", inventoryBoardId: inventoryId, enabled: true }]);
    const raw = { areaId: area.id, submitterName: "Test", feedback: "Original feedback", email: "person@example.invalid" };
    const opts = { activityDetail: "Test" };
    const jobs = () => db.select().from(emailOutbox);
    const missingFeedback = await submitPublicFeedback({ ...raw, email: undefined }, opts);
    assert.equal(missingFeedback.ok, false);
    const missingApplication = await submitPublicApplication({ locationId: location.id, title: "Test", applicant: "Person", files: {} }, opts);
    assert.equal(missingApplication.ok, false);
    if (!missingApplication.ok && missingApplication.reason === "validation") assert.equal(missingApplication.issues?.[0].field, "email");
    assert.equal((await submitPublicFeedback(raw, opts)).ok, true);
    assert.equal((await jobs()).length, 0, "SMTP disabled creates no queued mail");
    await db.update(smtpSettings).set({ enabled: true });
    await db.update(emailConfirmationSettings).set({ enabled: false }).where(eq(emailConfirmationSettings.kind, "feedback"));
    assert.equal((await submitPublicFeedback(raw, opts)).ok, true);
    assert.equal((await jobs()).length, 0, "per-board receipt off creates no mail");
    await db.update(emailConfirmationSettings).set({ enabled: true });
    const failed = await submitPublicFeedback(raw, { ...opts, withinTx: async () => { throw new Error("rollback"); } });
    assert.equal(failed.ok, false); assert.equal((await jobs()).length, 0, "rollback includes mail");
    const feedback = await submitPublicFeedback(raw, opts); assert.equal(feedback.ok, true);
    assert.equal((await jobs()).length, 1);
    await submitPublicFeedback(raw, { ...opts, preflightTx: async () => "replayed" });
    assert.equal((await jobs()).length, 1, "idempotency preflight queues nothing");
    assert.notEqual(computeFeedbackFingerprint(raw), computeFeedbackFingerprint({ ...raw, email: "other@example.invalid" }));
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = new Uint8Array(await pdf.save());
    const application = await submitPublicApplication({ locationId: location.id, title: "Public application", applicant: "Person", email: raw.email, files: { finance_request: new File([bytes], "request.pdf", { type: "application/pdf" }), student_card: new File([bytes], "id.pdf", { type: "application/pdf" }) } }, opts);
    assert.equal(application.ok, true);
    if (application.ok) {
      const status = await getApplicationStatusByToken(application.token);
      assert.ok(status); assert.equal(JSON.stringify(status).includes(raw.email), false, "email never exposed by status");
    }
    await assert.rejects(createLoanRequest([{ itemId: item.id, quantity: 1 }], { borrower: "Person", borrowerEmail: null, purpose: null, startDate: null, endDate: null, notes: null }, { filename: "id.pdf", relPath: "missing-email-test.pdf", mime: "application/pdf", size: 4 }));
    const loan = await createLoanRequest([{ itemId: item.id, quantity: 1 }], { borrower: "Person", borrowerEmail: raw.email, purpose: null, startDate: null, endDate: null, notes: null }, { filename: "id.pdf", relPath: "missing-email-test.pdf", mime: "application/pdf", size: 4 });
    const confirmations = await jobs(); assert.equal(confirmations.length, 3);
    assert.deepEqual(new Set(confirmations.map(job => job.kind)), new Set(["feedback", "application", "inventory"]));
    for (const job of confirmations) {
      const rendered = await renderEmail(job);
      const prefix = job.kind === "feedback" ? "/feedback/status/" : job.kind === "inventory" ? "/inventar/status/" : "/status/";
      assert.ok(rendered.text.includes(`${process.env.PUBLIC_BASE_URL}${prefix}${job.kind === "inventory" ? loan.token : job.payload.statusLink}`));
      assert.equal(rendered.attachments.length, 1); assert.equal(rendered.attachments[0].filename, "eingangsbestaetigung.pdf");
      assert.ok((await PDFDocument.load(rendered.attachments[0].content)).getPageCount() >= 1);
    }
    await db.insert(boardEmailRules).values({ statusId: second.id, enabled: true, recipients: ["one@example.invalid", "two@example.invalid"] });
    const [card] = await db.insert(cards).values({ boardId, statusId: second.id, title: "Status test", applicant: "Private", token: suffix, notes: "SECRET INTERNAL NOTE" }).returning();
    assert.equal((await jobs()).length, 5, "insert into configured column queues for both recipients");
    await db.update(cards).set({ statusId: second.id, position: 4 }).where(eq(cards.id, card.id));
    assert.equal((await jobs()).length, 5, "same status and reorder do not queue");
    await assert.rejects(db.transaction(async tx => { await tx.update(cards).set({ statusId: first.id }).where(eq(cards.id, card.id)); await tx.update(cards).set({ statusId: second.id }).where(eq(cards.id, card.id)); throw new Error("rollback"); }));
    assert.equal((await jobs()).length, 5);
    await db.update(cards).set({ statusId: first.id }).where(eq(cards.id, card.id));
    await db.update(cards).set({ statusId: second.id }).where(eq(cards.id, card.id));
    assert.equal((await jobs()).length, 7);
    await db.update(smtpSettings).set({ enabled: false }); assert.equal(await processEmailQueue(), 0);
    await db.update(smtpSettings).set({ enabled: true });
    assert.equal(await processEmailQueue(), 7);
    assert.equal(captured.length, 7); assert.equal(recipients.length, 7, "one recipient per message, never a recipient list");
    assert.equal(captured.some(message => message.includes("SECRET INTERNAL NOTE")), false);
    assert.equal(captured.filter(message => message.includes("Content-Type: application/pdf")).length, 3);
    assert.equal(captured.some(message => message.includes("id.pdf")), false, "student ID is never attached");
    assert.ok((await jobs()).every(job => job.state === "sent" && job.recipient === "" && job.payload.title === ""), "successful sensitive payload is cleared");
    assert.equal(await processEmailQueue(), 0, "sent jobs never resend");
    await db.insert(emailOutbox).values({ kind: "status", recipient: "retry@example.invalid", payload: { title: "Retry", cardId: card.id, boardName: "Test", statusName: "Done" } });
    await db.update(smtpSettings).set({ port: 1 });
    assert.equal(await processEmailQueue(), 0);
    const retry = (await jobs()).find(job => job.state === "pending")!;
    assert.equal(retry.attempts, 1); assert.ok(retry.nextAttemptAt > new Date()); assert.match(retry.lastErrorCode!, /^[A-Z0-9_]+$/);
    await db.update(emailOutbox).set({ attempts: 4, nextAttemptAt: new Date(0) }).where(eq(emailOutbox.id, retry.id));
    await processEmailQueue(); assert.equal((await jobs()).find(job => job.id === retry.id)?.state, "failed");
    await db.update(emailOutbox).set({ state: "pending", attempts: 0, nextAttemptAt: new Date(0) }).where(eq(emailOutbox.id, retry.id));
    await db.update(smtpSettings).set({ port }); assert.equal(await processEmailQueue(), 1);
    assert.ok(captured.at(-1)?.includes(`gremio-mail-${retry.id}@`));
  } finally {
    await db.delete(emailOutbox); await db.delete(smtpSettings);
    if (boardId) { await db.delete(locations).where(eq(locations.targetBoardId, boardId)); await db.delete(feedbackAreas).where(eq(feedbackAreas.targetBoardId, boardId)); await db.delete(boards).where(eq(boards.id, boardId)); }
    if (inventoryId) await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inventoryId));
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId));
    await new Promise<void>(resolve => server.close(() => resolve())); await pool.end();
  }
});
