// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { boards, inventoryBoards, smtpSettings, emailConfirmationSettings, emailOutbox } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { emailAddressSchema } from "@/lib/email-validation";
import { mailTransport } from "@/lib/email";
import { isPublicHost } from "@/lib/url-guard";
import { sanitizeSingleLine } from "@/lib/text";
export type EmailState = { error?: string; success?: string };

export async function saveSmtpAction(_previous: EmailState, form: FormData): Promise<EmailState> {
  await requireAdmin();
  const parsed = z.object({ host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9_.:\-]+$/), port: z.coerce.number().int().min(1).max(65535), security: z.enum(["starttls", "tls", "none"]), fromEmail: emailAddressSchema, replyTo: z.union([emailAddressSchema, z.literal("")]), username: z.string().trim().max(254), password: z.string().max(2000) }).safeParse({ host: form.get("host"), port: form.get("port"), security: form.get("security"), fromEmail: form.get("fromEmail"), replyTo: form.get("replyTo") ?? "", username: form.get("username") ?? "", password: form.get("password") ?? "" });
  if (!parsed.success) return { error: "Bitte SMTP-Host, Port und gültige Absender-/Antwortadresse prüfen." };
  const data = parsed.data;
  if (data.security === "none" && isPublicHost(data.host)) return { error: "Für öffentliche SMTP-Server ist TLS oder STARTTLS erforderlich." };
  const [old] = await db.select().from(smtpSettings).where(eq(smtpSettings.id, 1));
  if (data.username && data.username !== old?.username && !data.password) return { error: "Bei neuem Benutzernamen bitte auch das Passwort eingeben." };
  const passwordEnc = !data.username ? null : data.password ? encryptSecret(data.password) : old?.passwordEnc ?? null;
  if (data.username && !passwordEnc) return { error: "Für SMTP-Anmeldung ist ein Passwort erforderlich. Für ein Relay ohne Anmeldung Benutzername leer lassen." };
  const values = { enabled: form.get("enabled") === "on", host: data.host, port: data.port, security: data.security, username: data.username || null, passwordEnc, fromEmail: data.fromEmail, fromName: sanitizeSingleLine(form.get("fromName")).slice(0, 100) || "Gremio", replyTo: data.replyTo || null };
  await db.insert(smtpSettings).values(values).onConflictDoUpdate({ target: smtpSettings.id, set: values });
  revalidatePath("/admin/email");
  return { success: "SMTP-Einstellungen gespeichert." };
}
export async function verifySmtpAction(_previous: EmailState): Promise<EmailState> {
  await requireAdmin();
  const [config] = await db.select().from(smtpSettings).where(eq(smtpSettings.id, 1));
  if (!config) return { error: "Bitte zuerst SMTP speichern." };
  const transport = mailTransport(config);
  try { await transport.verify(); return { success: "Verbindung und Anmeldung erfolgreich geprüft. Es wurde keine E-Mail versendet." }; }
  catch { return { error: "SMTP-Verbindung oder Anmeldung fehlgeschlagen. Bitte Einstellungen prüfen." }; }
  finally { transport.close(); }
}
export async function saveEmailConfirmationAction(kind: "application" | "feedback" | "inventory", resourceId: number, form: FormData): Promise<void> {
  await requireAdmin();
  if (!["application", "feedback", "inventory"].includes(kind) || !Number.isSafeInteger(resourceId) || resourceId < 1 || resourceId > 2147483647) return;
  const [resource] = kind === "inventory" ? await db.select({ id: inventoryBoards.id }).from(inventoryBoards).where(eq(inventoryBoards.id, resourceId)) : await db.select({ id: boards.id }).from(boards).where(eq(boards.id, resourceId));
  if (!resource) return;
  const enabled = form.get("enabled") === "on";
  if (kind === "inventory") await db.insert(emailConfirmationSettings).values({ kind, inventoryBoardId: resourceId, enabled }).onConflictDoUpdate({ target: emailConfirmationSettings.inventoryBoardId, set: { enabled } });
  else await db.insert(emailConfirmationSettings).values({ kind, boardId: resourceId, enabled }).onConflictDoUpdate({ target: [emailConfirmationSettings.boardId, emailConfirmationSettings.kind], set: { enabled } });
  revalidatePath("/admin/email");
}
export async function retryFailedEmailsAction(): Promise<void> {
  await requireAdmin();
  await db.update(emailOutbox).set({ state: "pending", attempts: 0, nextAttemptAt: new Date(), lastErrorCode: null }).where(and(eq(emailOutbox.state, "failed")));
  revalidatePath("/admin/email");
}
