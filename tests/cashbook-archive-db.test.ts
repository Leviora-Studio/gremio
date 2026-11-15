// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { mkdtemp,readFile,writeFile,mkdir,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq } from "drizzle-orm";
import { db,pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { defaultCashbookConfig } from "../lib/cashbook-types";
import { decryptSecret } from "../lib/crypto";
import { env } from "../lib/env";
import { moveToTrash,restoreTrashEntry,purgeTrashEntry } from "../lib/trash";
after(()=>pool.end());
test("cashbook archive is owner-only, queues at authorization, includes all files, retries safely and never changes posted accounting",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);assert.match(env.UPLOAD_DIR,/^\/private\/tmp\/gremio-cashbook-test-/);
 const temporary=await mkdtemp(join(tmpdir(),"gremio-cashbook-archive-")),entry=join(temporary,"archive.cjs");
 await build({stdin:{contents:'export * from "@/lib/cashbook/archive"; export { transitionCashbook } from "@/lib/cashbook/service";',resolveDir:process.cwd()},outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"synthetic-nextcloud",setup(builder){builder.onResolve({filter:/^@\/lib\/nextcloud$/},()=>({path:"nc",namespace:"test"}));builder.onLoad({filter:/.*/,namespace:"test"},()=>({contents:'export async function testConnection(){globalThis.__cashbookArchive.tests++;return {ok:true};} export async function uploadAntragArchive(data){const state=globalThis.__cashbookArchive;state.calls++;state.uploads.push(data);if(state.failures-->0)throw Error("Synthetic private upload failure");return data.targetFolder+"/"+data.subfolder;}',loader:"js"}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);const api=loaded.exports;
 const context=globalThis as unknown as {__cashbookArchive:{calls:number;tests:number;failures:number;uploads:{subfolder:string;targetFolder:string;files:{relPath:string;filename:string}[]}[]}};context.__cashbookArchive={calls:0,tests:0,failures:0,uploads:[]};const state=context.__cashbookArchive;
 const [owner,second,reader,office]=await db.insert(s.users).values(["owner","second","reader","office"].map(role=>({username:`cashbook-nc-${role}-${randomUUID()}`,role:role==="owner"||role==="reader"?"admin" as const:"user" as const}))).returning();
 const [book]=await db.insert(s.cashbooks).values({name:"Archive book",ownerId:owner.id,config:{...defaultCashbookConfig,officeId:office.id}}).returning();await db.insert(s.cashbookAccess).values([{cashbookId:book.id,userId:second.id,accessLevel:"write"},{cashbookId:book.id,userId:reader.id,accessLevel:"read"}]);
 const config={enabled:true,ncUrl:"https://synthetic.invalid/remote.php/dav/files/test/",ncUsername:"synthetic",ncPassword:"synthetic-only-password",targetFolder:"/Book archive"};
 const payment={cardId:null,business:true,number:"G-2026-0001",receiptIds:[],amount:12345,budgetTitle:"1200",holder:"Original holder",iban:"DE89370400440532013000",bank:"Original bank",purpose:"Original purpose",place:"",date:""};
 const bytes=Buffer.from("%PDF synthetic-immutable-bytes"),hash=createHash("sha256").update(bytes).digest("hex");
 const folder=join(env.UPLOAD_DIR,`cashbooks/${book.id}/fixture`);await mkdir(folder,{recursive:true});
 const files=await Promise.all(["application","receipt","form","signed"].map(async(kind,index)=>{const path=`cashbooks/${book.id}/fixture/${index}.pdf`;await writeFile(join(env.UPLOAD_DIR,path),bytes);return {id:randomUUID(),kind:kind as "application"|"receipt"|"form"|"signed",filename:index>1?"Anweisung.pdf":`${kind}.pdf`,path,mime:"application/pdf",sha256:hash,obsolete:index===2};}));
 const submitted=async(number:string)=> (await db.insert(s.cashbookEntries).values({cashbookId:book.id,creatorId:owner.id,state:"submitted",role:"speaker",secondSignerId:second.id,firstSignedAt:new Date(),secondSignedAt:new Date(),data:{...payment,number},files}).returning())[0];
 const job=async(id:number)=>(await db.select().from(s.cashbookArchiveJobs).where(eq(s.cashbookArchiveJobs.entryId,id)))[0];const read=async(id:number)=>(await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,id)))[0];
 try{
  assert.equal((await api.cashbookArchiveSettings(owner,book.id)).enabled,false);
  for(const user of [second,reader,office]){await assert.rejects(api.saveCashbookArchive(user,book.id,0,config));await assert.rejects(api.cashbookArchiveSettings(user,book.id));await assert.rejects(api.testCashbookArchive(user,book.id));}
  for(const ncUrl of ["http://public.example.org/dav","https://127.0.0.1/dav","file:///tmp/a"])await assert.rejects(api.saveCashbookArchive(owner,book.id,0,{...config,ncUrl}));
  const historical=(await db.insert(s.cashbookEntries).values({cashbookId:book.id,creatorId:owner.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:{...payment,number:"Old"},files}).returning())[0];
  await api.saveCashbookArchive(owner,book.id,0,config);assert.equal(await job(historical.id),undefined,"enabling does not export earlier bookings");
  const [saved]=await db.select().from(s.cashbookArchive).where(eq(s.cashbookArchive.cashbookId,book.id));assert.notEqual(saved.ncPasswordEnc,config.ncPassword);assert.equal(decryptSecret(saved.ncPasswordEnc!),config.ncPassword);
  const publicSettings=await api.cashbookArchiveSettings(owner,book.id);assert.equal(publicSettings.hasPassword,true);assert.equal(JSON.stringify(publicSettings).includes(config.ncPassword),false);assert.equal(JSON.stringify(publicSettings).includes(saved.ncPasswordEnc!),false);
  const settingsHistory=await db.select().from(s.cashbookActivity).where(eq(s.cashbookActivity.cashbookId,book.id));assert.equal(JSON.stringify(settingsHistory).includes(config.ncPassword),false);assert.equal(JSON.stringify(settingsHistory).includes(saved.ncPasswordEnc!),false);
  await api.testCashbookArchive(owner,book.id);assert.equal(state.tests,1);
  await api.saveCashbookArchive(owner,book.id,1,{...config,ncPassword:""});assert.equal((await db.select().from(s.cashbookArchive).where(eq(s.cashbookArchive.cashbookId,book.id)))[0].ncPasswordEnc,saved.ncPasswordEnc);
  await assert.rejects(api.saveCashbookArchive(owner,book.id,0,config),/geändert/);
  const first=await submitted("AN-2026-0042");assert.equal(await job(first.id),undefined);await assert.rejects(api.transitionCashbook(owner,first.id,0,"authorize",{}));
  await api.transitionCashbook(second,first.id,0,"authorize",{});const posted=await read(first.id);assert.equal(posted.state,"posted");assert.ok(posted.bookingNumber);assert.equal((await job(first.id)).archivePath,`/Book archive/${posted.bookingNumber} AN-2026-0042`);assert.ok((await job(first.id)).archivedAt);
  assert.deepEqual(state.uploads.at(-1)!.files.map(file=>file.relPath),files.map(file=>file.path),"includes obsolete files and both versions with equal display names");
  const before=await read(first.id);await api.maybeArchiveCashbookEntry(first.id);assert.deepEqual(await read(first.id),before);const previousCalls=state.calls;
  await api.transitionCashbook(second,first.id,before.revision,"bookingDate",{date:"2026-11-15"});assert.equal(state.calls,previousCalls);assert.ok((await read(first.id)).bookingDate);
  await assert.rejects(db.update(s.cashbookEntries).set({data:{...payment,amount:1}}).where(eq(s.cashbookEntries.id,first.id)));await assert.rejects(db.update(s.cashbookArchiveJobs).set({archivePath:"/changed"}).where(eq(s.cashbookArchiveJobs.entryId,first.id)));
  const correction=(await db.insert(s.cashbookEntries).values({cashbookId:book.id,creatorId:owner.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:{...payment,amount:999},files,correctsId:first.id,correctionReason:"Original correction"}).returning())[0];assert.equal(await job(correction.id),undefined);await api.maybeArchiveCashbookEntry(correction.id);assert.equal(state.calls,previousCalls);
  const failing=await submitted("G-2026-0002");state.failures=1;await api.transitionCashbook(second,failing.id,0,"authorize",{});assert.equal((await read(failing.id)).state,"posted");assert.equal((await job(failing.id)).archivedAt,null);assert.ok((await job(failing.id)).lastError);assert.equal((await job(failing.id)).lastError!.includes("Synthetic private"),false);
  const failedSnapshot=await read(failing.id);await api.retryCashbookArchives();assert.ok((await job(failing.id)).archivedAt);assert.deepEqual(await read(failing.id),failedSnapshot);assert.equal((await job(failing.id)).attempts,2);
  // A remote success followed by a failed local acknowledgement stays pending.
  const unacknowledged=await submitted("G-2026-ACK");
  await pool.query(`create function test_book_archive_ack() returns trigger language plpgsql as $$ begin raise exception 'Synthetic archive ack failure'; end $$; create trigger test_book_archive_ack before insert on cashbook_activity for each row when (NEW.type='nextcloud_archived' and NEW.entry_id=${unacknowledged.id}) execute function test_book_archive_ack()`);
  try{await api.transitionCashbook(second,unacknowledged.id,0,"authorize",{});assert.equal((await job(unacknowledged.id)).archivedAt,null);assert.equal((await read(unacknowledged.id)).state,"posted");}finally{await pool.query("drop trigger test_book_archive_ack on cashbook_activity; drop function test_book_archive_ack()");}
  const unchanged=await read(unacknowledged.id);await api.retryCashbookArchives();assert.ok((await job(unacknowledged.id)).archivedAt);assert.deepEqual(await read(unacknowledged.id),unchanged);
  // Historical bytes are checked as well, even when obsolete in the UI.
  await writeFile(join(env.UPLOAD_DIR,files[2].path),"tampered synthetic bytes");const damaged=await submitted("G-2026-DAMAGED");await api.transitionCashbook(second,damaged.id,0,"authorize",{});assert.equal((await job(damaged.id)).archivedAt,null);await writeFile(join(env.UPLOAD_DIR,files[2].path),bytes);await api.retryCashbookArchives();assert.ok((await job(damaged.id)).archivedAt);
  // Commit without any post-commit call (or after a server exit) still queues.
  const skipped=await submitted("G-2026-0003");await assert.rejects(db.transaction(async tx=>{await tx.update(s.cashbookEntries).set({state:"posted",authorizedAt:new Date()}).where(eq(s.cashbookEntries.id,skipped.id));throw Error("rollback");}));assert.equal(await job(skipped.id),undefined);
  await db.update(s.cashbookEntries).set({state:"posted",authorizedAt:new Date()}).where(eq(s.cashbookEntries.id,skipped.id));assert.ok(await job(skipped.id));
  const locker=await pool.connect();try{await locker.query("select pg_advisory_lock($1,$2)",[0x4341,skipped.id]);await api.maybeArchiveCashbookEntry(skipped.id);assert.equal((await job(skipped.id)).attempts,0);}finally{await locker.query("select pg_advisory_unlock($1,$2)",[0x4341,skipped.id]);locker.release();}
  await api.saveCashbookArchive(owner,book.id,2,{...config,enabled:false,ncPassword:""});const pausedCalls=state.calls;await api.retryCashbookArchives();assert.equal(state.calls,pausedCalls);assert.equal((await job(skipped.id)).archivedAt,null);
  await api.saveCashbookArchive(owner,book.id,3,{...config,ncPassword:""});const trash=await moveToTrash(owner,"cashbook",book.id,"LÖSCHEN",{cashbookName:book.name});await api.retryCashbookArchives();assert.equal(state.calls,pausedCalls);await restoreTrashEntry(owner,trash,"WIEDERHERSTELLEN");await api.retryCashbookArchives();assert.ok((await job(skipped.id)).archivedAt);
  assert.deepEqual(await read(historical.id),historical,"archive settings leave existing posted values untouched");
 }finally{
  const trash=await moveToTrash(owner,"cashbook",book.id,"LÖSCHEN",{cashbookName:book.name});await purgeTrashEntry(owner,trash,"ENDGÜLTIG");assert.equal((await db.select().from(s.cashbookArchiveJobs).where(eq(s.cashbookArchiveJobs.cashbookId,book.id))).length,0);
  for(const person of [owner,second,reader,office])await db.delete(s.users).where(eq(s.users.id,person.id));delete (context as Partial<typeof context>).__cashbookArchive;await rm(temporary,{recursive:true,force:true});
 }
});
