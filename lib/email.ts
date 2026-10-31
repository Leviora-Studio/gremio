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

import { receiptCopy } from "@/lib/receipt-copy";
import { getReceiptBranding } from "@/lib/receipt-branding";
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
  const branding=await getReceiptBranding(p.receiptScope);
  const pdf = job.kind === "feedback" ? await buildFeedbackConfirmationPdf({ areaName: p.areaName!, submitterName: p.applicant!, feedbackText: p.feedbackText!, eingang: new Date(p.receivedAt!), statusLink, number: p.number,branding })
    : await buildConfirmationPdf({ kind: job.kind === "inventory" ? "inventory" : "application", title: p.title, applicant: p.applicant!, eingang: new Date(p.receivedAt!), statusLink, number: p.number,branding });
  const copy=receiptCopy(job.kind as "application"|"inventory"|"feedback");
  const text=`${copy.greeting}\n\n${copy.introduction}\n\n${p.title}${p.number?`\nVorgangsnummer: ${p.number}`:""}\n\n${copy.statusText}\n${statusLink}\n\n${copy.attachmentText} ${copy.privacyText}\n\n${copy.closing}\n${branding.organization}\n\n${copy.disclaimer}`;
  const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
  const html=`<!doctype html><html lang="de"><body style="margin:0;background:#f3f5f7;color:#202934;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:auto;background:#fff;border:1px solid #dde2e7"><tr><td style="padding:32px;border-bottom:1px solid #dde2e7">${branding.logoPng?'<img src="cid:receipt-logo" alt="" style="display:block;max-width:160px;max-height:70px;margin-bottom:20px"/>':""}<strong>${escape(branding.organization)}</strong></td></tr><tr><td style="padding:32px;line-height:1.6"><p style="margin:0 0 8px;color:#657180;font-size:12px">EMPFANGSBESTÄTIGUNG</p><h1 style="margin:0 0 24px;font-size:23px">${escape(copy.headline)}</h1><p>${escape(copy.greeting)}</p><p>${escape(copy.introduction)}</p><p><strong>${escape(p.title)}</strong>${p.number?`<br/>Vorgangsnummer: ${escape(p.number)}`:""}</p><p>${escape(copy.statusText)}</p><p><a href="${escape(statusLink)}" style="color:#234c7b">Bearbeitungsstand ansehen</a></p><p>${escape(copy.attachmentText)} ${escape(copy.privacyText)}</p><p>${escape(copy.closing)}<br/>${escape(branding.organization)}</p><p style="margin-top:28px;color:#657180;font-size:12px">${escape(copy.disclaimer)}</p></td></tr></table></td></tr></table></body></html>`;
  const attachments:{filename:string;content:Buffer;contentType:string;cid?:string;contentDisposition?:"inline"}[]=[{filename:"eingangsbestaetigung.pdf",content:Buffer.from(pdf),contentType:"application/pdf"}];
  if(branding.logoPng)attachments.push({filename:"logo.png",content:Buffer.from(branding.logoPng,"base64"),contentType:"image/png",cid:"receipt-logo",contentDisposition:"inline"});
  return {subject,text,html,attachments};
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
