// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { db, pool, schema } from "@/lib/db";
import { cashbookArchive, cashbookArchiveJobs, cashbookActivity, cashbookEntries, cashbooks, users, type User } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { isSafeExternalUrl } from "@/lib/url-guard";
import { uploadAntragArchive, testConnection } from "@/lib/nextcloud";
import { sanitizeSegment } from "@/lib/attachment-organization";
import { requireCashbook } from "./access";
import { verifyCashbookFiles } from "./source-files";
import { activeRows } from "@/lib/trash-visibility";

export const cashbookArchiveConfigSchema = z.object({
 enabled: z.boolean(), ncUrl: z.string().trim().max(2048), ncUsername: z.string().trim().max(500),
 ncPassword: z.string().max(4000), targetFolder: z.string().trim().max(2000),
}).strict();
export type CashbookArchiveInput = z.infer<typeof cashbookArchiveConfigSchema>;
export type CashbookArchiveSettings = { enabled: boolean; ncUrl: string; ncUsername: string; targetFolder: string; hasPassword: boolean; revision: number };
const LOCK_NS = 0x4341;
const genericError = "Nextcloud-Archivierung fehlgeschlagen. Der Auftrag bleibt gespeichert und wird automatisch erneut versucht. Bitte Verbindung, Zugangsdaten und lokale Dateien prüfen.";

async function requireArchiveOwner(user:User,bookId:number) {
 const access=await requireCashbook(user,bookId,"manage");
 if(access.book.ownerId!==user.id)throw new Error("Nur der Eigentümer kann die Nextcloud-Archivierung verwalten.");
 return access;
}
/** Never expose password/ciphertext in props or audit snapshots. */
export async function cashbookArchiveSettings(user: User, bookId: number): Promise<CashbookArchiveSettings> {
 await requireArchiveOwner(user, bookId);
 const [config] = await db.select().from(cashbookArchive).where(eq(cashbookArchive.cashbookId, bookId));
 return { enabled: config?.enabled ?? false, ncUrl: config?.ncUrl ?? "", ncUsername: config?.ncUsername ?? "", targetFolder: config?.targetFolder ?? "", hasPassword: !!config?.ncPasswordEnc, revision: config?.revision ?? 0 };
}
export async function saveCashbookArchive(user: User, bookId: number, revision: number, raw: unknown) {
 const input = cashbookArchiveConfigSchema.parse(raw);
 if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Bitte die Einstellungen neu laden.");
 if (input.ncUrl && (!isSafeExternalUrl(input.ncUrl) || new URL(input.ncUrl).protocol !== "https:")) throw new Error("Bitte eine öffentliche HTTPS-WebDAV-URL eingeben.");
 if ([input.ncUrl,input.ncUsername,input.targetFolder].some(value => /[\x00-\x1f\x7f]/.test(value))) throw new Error("URL, Benutzername und Stammordner dürfen keine Steuerzeichen enthalten.");
 await requireArchiveOwner(user, bookId);
 await db.transaction(async tx => {
  const [person] = await tx.select().from(users).where(eq(users.id,user.id)).for("share");
  if (!person?.isActive) throw new Error("Kein aktiver Verwaltungszugriff.");
  const [book] = await tx.select().from(cashbooks).where(and(activeRows.cashbooks,eq(cashbooks.id,bookId))).for("update");
  if (!book) throw new Error("Kassenbuch nicht verfügbar.");
  if(book.ownerId!==person.id)throw new Error("Nur der Eigentümer kann die Nextcloud-Archivierung verwalten.");
  const [current] = await tx.select().from(cashbookArchive).where(eq(cashbookArchive.cashbookId,bookId));
  if ((current?.revision ?? 0) !== revision) throw new Error("Die Archiv-Einstellungen wurden geändert. Bitte neu laden.");
  const password = input.ncPassword ? encryptSecret(input.ncPassword) : current?.ncPasswordEnc ?? null;
  if (input.enabled && (!input.ncUrl || !input.ncUsername || !password || !input.targetFolder)) throw new Error("Zum Aktivieren bitte WebDAV-URL, Benutzername, Passwort und Stammordner angeben.");
  const config = { enabled:input.enabled,ncUrl:input.ncUrl||null,ncUsername:input.ncUsername||null,ncPasswordEnc:password,targetFolder:input.targetFolder||null,revision:revision+1 };
  await tx.insert(cashbookArchive).values({cashbookId:bookId,...config}).onConflictDoUpdate({target:cashbookArchive.cashbookId,set:config});
  const safe = (value:typeof config) => ({ enabled:value.enabled,ncUrl:value.ncUrl,ncUsername:value.ncUsername,targetFolder:value.targetFolder,hasPassword:!!value.ncPasswordEnc });
  await tx.insert(cashbookActivity).values({cashbookId:bookId,userId:user.id,type:"archive_settings",detail:{before:current?safe(current):null,after:safe(config),comment:"Nextcloud-Archiv-Einstellungen geändert"}});
 });
}
export async function testCashbookArchive(user: User, bookId: number) {
 await requireArchiveOwner(user, bookId);
 const [config]=await db.select().from(cashbookArchive).where(eq(cashbookArchive.cashbookId,bookId));
 if (!config?.ncUrl||!config.ncUsername||!config.ncPasswordEnc||!config.targetFolder) throw new Error("Bitte die vollständige Verbindung zuerst speichern.");
 const result=await testConnection({url:config.ncUrl,username:config.ncUsername,password:decryptSecret(config.ncPasswordEnc)},config.targetFolder);
 if (!result.ok) throw new Error("Verbindung fehlgeschlagen. Bitte URL, Zugangsdaten und Stammordner prüfen.");
}
export function cashbookArchiveFolder(bookingNumber:string, number:string) { return sanitizeSegment(`${bookingNumber} ${number}`); }

/** The AFTER-posting trigger already saved the request in the accounting commit.
 * A missed/contended immediate call is recovered by the durable worker. */
export async function maybeArchiveCashbookEntry(entryId:number) {
 if (!Number.isSafeInteger(entryId)||entryId<1||entryId>2147483647) return;
 const client=await pool.connect();
 try {
  const lock=await client.query<{locked:boolean}>("select pg_try_advisory_lock($1,$2) as locked",[LOCK_NS,entryId]);
  if (!lock.rows[0]?.locked) return;
  try {
   const connection=drizzle(client,{schema});
   const [row]=await connection.select({job:cashbookArchiveJobs,entry:cashbookEntries,config:cashbookArchive})
    .from(cashbookArchiveJobs).innerJoin(cashbookEntries,eq(cashbookEntries.id,cashbookArchiveJobs.entryId))
    .innerJoin(cashbooks,eq(cashbooks.id,cashbookEntries.cashbookId))
    .innerJoin(cashbookArchive,eq(cashbookArchive.cashbookId,cashbooks.id))
    .where(and(eq(cashbookArchiveJobs.entryId,entryId),isNull(cashbookArchiveJobs.archivedAt),activeRows.cashbooks));
   if (!row||!row.config.enabled) return; // disabled/trashed books pause pending work
   const {entry,config}=row;
   if(entry.state!=="posted"||entry.correctsId!=null||!entry.bookingNumber) return;
   const now=new Date();
   await connection.update(cashbookArchiveJobs).set({attempts:sql`${cashbookArchiveJobs.attempts}+1`,lastAttemptAt:now}).where(eq(cashbookArchiveJobs.entryId,entryId));
   try {
    if(!config.ncUrl||!config.ncUsername||!config.ncPasswordEnc||!config.targetFolder)throw new Error("Incomplete saved archive connection");
    // Include historical/obsolete versions too: every file attached to this immutable entry.
    await verifyCashbookFiles(entry.files.map(file=>({...file,obsolete:false})));
    const folder=await uploadAntragArchive({creds:{url:config.ncUrl,username:config.ncUsername,password:decryptSecret(config.ncPasswordEnc)},targetFolder:config.targetFolder,
     subfolder:cashbookArchiveFolder(entry.bookingNumber,entry.data.number),folders:[],
     files:entry.files.map((file,index)=>({id:index+1,relPath:file.path,filename:file.filename,folderId:null}))});
    await connection.transaction(async tx=>{
     const [liveBook]=await tx.select({id:cashbooks.id}).from(cashbooks).where(and(activeRows.cashbooks,eq(cashbooks.id,entry.cashbookId))).for("share");
     if(!liveBook)throw new Error("Book no longer available for acknowledgement");
     await tx.update(cashbookArchiveJobs).set({archivedAt:new Date(),archivePath:folder,lastError:null}).where(and(eq(cashbookArchiveJobs.entryId,entryId),isNull(cashbookArchiveJobs.archivedAt)));
     await tx.insert(cashbookActivity).values({cashbookId:entry.cashbookId,entryId,userId:row.job.requestedBy,type:"nextcloud_archived",detail:{comment:`Alle ${entry.files.length} Dateien nach Nextcloud archiviert: ${folder}`,archivePath:folder,archivedFiles:entry.files.map(file=>({filename:file.filename,sha256:file.sha256}))}});
    });
   } catch(error) {
    console.error(`[cashbook-archive] Entry #${entryId} failed`,error instanceof Error?error.name:"Error");
    await connection.transaction(async tx=>{
     const [pending]=await tx.update(cashbookArchiveJobs).set({lastError:genericError}).where(and(eq(cashbookArchiveJobs.entryId,entryId),isNull(cashbookArchiveJobs.archivedAt))).returning({entryId:cashbookArchiveJobs.entryId});
     const [liveBook]=await tx.select({id:cashbooks.id}).from(cashbooks).where(and(activeRows.cashbooks,eq(cashbooks.id,entry.cashbookId)));
     if(pending&&liveBook&&!row.job.lastError)await tx.insert(cashbookActivity).values({cashbookId:entry.cashbookId,entryId,userId:row.job.requestedBy,type:"nextcloud_archive_failed",detail:{comment:genericError}});
    });
   }
  } finally { await client.query("select pg_advisory_unlock($1,$2)",[LOCK_NS,entryId]); }
 } finally { client.release(); }
}
export async function retryCashbookArchives() {
 const jobs=await db.select({id:cashbookArchiveJobs.entryId}).from(cashbookArchiveJobs)
  .innerJoin(cashbooks,eq(cashbooks.id,cashbookArchiveJobs.cashbookId)).innerJoin(cashbookArchive,eq(cashbookArchive.cashbookId,cashbooks.id))
  .where(and(isNull(cashbookArchiveJobs.archivedAt),activeRows.cashbooks,eq(cashbookArchive.enabled,true))).orderBy(asc(cashbookArchiveJobs.requestedAt),asc(cashbookArchiveJobs.entryId));
 for(const job of jobs)await maybeArchiveCashbookEntry(job.id).catch(error=>console.error(`[cashbook-archive] Retry #${job.id}`,error instanceof Error?error.name:"Error"));
 return jobs.length;
}
