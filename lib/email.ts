// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import nodemailer from "nodemailer";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailConfirmationSettings, emailOutbox, smtpSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { emailAddressSchema, type EmailPayload } from "@/lib/email-validation";
import { publicBaseUrl } from "@/lib/public-api";
import { buildConfirmationPdf, buildFeedbackConfirmationPdf } from "@/lib/pdf";
import { env } from "@/lib/env";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function mailTransport(config: typeof smtpSettings.$inferSelect) {
  return nodemailer.createTransport({ host: config.host, port: config.port, secure: config.security === "tls", requireTLS: config.security === "starttls", ignoreTLS: config.security === "none",
    auth: config.username ? { user: config.username, pass: config.passwordEnc ? decryptSecret(config.passwordEnc) : "" } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
}

/** Queue in the submission transaction; replay/rollback cannot create another mail. */
export async function queueConfirmation(tx: Tx, kind: "application" | "feedback" | "inventory", resourceId: number, recipient: string, payload: EmailPayload): Promise<void> {
  const [smtp] = await tx.select({ enabled: smtpSettings.enabled }).from(smtpSettings).where(eq(smtpSettings.id, 1));
  if (!smtp?.enabled) return;
  const [setting] = await tx.select({ enabled: emailConfirmationSettings.enabled }).from(emailConfirmationSettings).where(and(eq(emailConfirmationSettings.kind, kind), kind === "inventory" ? eq(emailConfirmationSettings.inventoryBoardId, resourceId) : eq(emailConfirmationSettings.boardId, resourceId)));
  if (setting?.enabled) await tx.insert(emailOutbox).values({ kind, recipient, payload });
}

export async function renderEmail(job: typeof emailOutbox.$inferSelect) {
  const p = job.payload;
  const subject = (job.kind === "status" ? `Gremio: ${p.statusName} – ${p.title}` : `Gremio: Empfangsbestätigung – ${p.title}`).replace(/[\r\n]/g, " ").slice(0, 400);
  if (job.kind === "status") return { subject, text: `Eine Karte hat die Spalte „${p.statusName}“ auf dem Board „${p.boardName}“ erreicht.\n\n${p.title}\n\nKarte öffnen (Anmeldung erforderlich): ${env.APP_BASE_URL}/intern/card/${p.cardId}`, attachments: [] };
  const prefix = job.kind === "feedback" ? "/feedback/status/" : job.kind === "inventory" ? "/inventar/status/" : "/status/";
  // Only application-generated public URLs of the correct token type are used.
  const statusLink = `${publicBaseUrl()}${prefix}${p.statusLink}`;
  const pdf = job.kind === "feedback" ? await buildFeedbackConfirmationPdf({ areaName: p.areaName!, submitterName: p.applicant!, feedbackText: p.feedbackText!, eingang: new Date(p.receivedAt!), statusLink, number: p.number })
    : await buildConfirmationPdf({ kind: job.kind === "inventory" ? "inventory" : "application", title: p.title, applicant: p.applicant!, eingang: new Date(p.receivedAt!), statusLink, number: p.number });
  return { subject, text: `Vielen Dank! Wir haben ${job.kind === "inventory" ? "deine Ausleihanfrage" : job.kind === "feedback" ? "dein Feedback" : "deinen Antrag"} erhalten.\n\n${p.title}\n\nDen aktuellen Status findest du hier:\n${statusLink}\n\nDie PDF-Eingangsbestätigung ist dieser E-Mail beigefügt. Bitte bewahre den persönlichen Status-Link vertraulich auf.`, attachments: [{ filename: "eingangsbestaetigung.pdf", content: Buffer.from(pdf), contentType: "application/pdf" }] };
}

/** Claim briefly, send without DB locks, then finalize. Stable Message-ID across retries. */
export async function processEmailQueue(limit = 10): Promise<number> {
  const [config] = await db.select().from(smtpSettings).where(eq(smtpSettings.id, 1));
  if (!config?.enabled) return 0;
  await db.update(emailOutbox).set({ state: "pending", lockedAt: null }).where(and(eq(emailOutbox.state, "sending"), lte(emailOutbox.lockedAt, new Date(Date.now() - 10 * 60_000))));
  let sent = 0;
  const transport = mailTransport(config);
  try {
    for (let i = 0; i < Math.min(limit, 50); i++) {
      const job = await db.transaction(async tx => {
        const [currentConfig] = await tx.select({ enabled: smtpSettings.enabled }).from(smtpSettings).where(eq(smtpSettings.id, 1));
        if (!currentConfig?.enabled) return null;
        const [next] = await tx.select().from(emailOutbox).where(and(eq(emailOutbox.state, "pending"), lte(emailOutbox.nextAttemptAt, new Date()))).orderBy(asc(emailOutbox.id)).limit(1).for("update", { skipLocked: true });
        if (!next) return null;
        await tx.update(emailOutbox).set({ state: "sending", lockedAt: new Date(), attempts: next.attempts + 1 }).where(eq(emailOutbox.id, next.id));
        return { ...next, attempts: next.attempts + 1 };
      });
      if (!job) break;
      try {
        const recipient = emailAddressSchema.parse(job.recipient);
        const message = await renderEmail(job);
        const info = await transport.sendMail({ from: { name: config.fromName, address: config.fromEmail }, replyTo: config.replyTo || undefined, to: recipient, messageId: `<gremio-mail-${job.id}@${new URL(env.APP_BASE_URL).hostname}>`, ...message });
        if (!info.accepted?.length) throw Object.assign(new Error("Rejected"), { code: "ERECIPIENT" });
        await db.update(emailOutbox).set({ state: "sent", sentAt: new Date(), lockedAt: null, lastErrorCode: null, recipient: "", payload: { title: "" } }).where(eq(emailOutbox.id, job.id));
        sent++;
      } catch (error) {
        const rawCode = (error as { code?: unknown })?.code;
        const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : "EMAIL_FAILED";
        await db.update(emailOutbox).set({ state: job.attempts >= 5 ? "failed" : "pending", lockedAt: null, lastErrorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000) }).where(eq(emailOutbox.id, job.id));
      }
    }
    await db.delete(emailOutbox).where(and(eq(emailOutbox.state, "sent"), lte(emailOutbox.sentAt, new Date(Date.now() - 7 * 86400_000))));
    return sent;
  } finally { transport.close(); }
}

const globalMail = globalThis as unknown as { __emailWorkerStarted?: boolean; __emailWorkerRunning?: boolean };
export function startEmailWorker(): void {
  if (globalMail.__emailWorkerStarted) return;
  globalMail.__emailWorkerStarted = true;
  const tick = async () => {
    if (globalMail.__emailWorkerRunning) return;
    globalMail.__emailWorkerRunning = true;
    try { await processEmailQueue(); } catch { console.error("[email] Versandwarteschlange derzeit nicht verfügbar."); }
    finally { globalMail.__emailWorkerRunning = false; }
  };
  void tick();
  setInterval(() => void tick(), 15_000).unref();
}
