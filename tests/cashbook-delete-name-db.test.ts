// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {eq} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import {defaultCashbookConfig} from "../lib/cashbook-types";
import {moveToTrash,restoreTrashEntry,purgeTrashEntry} from "../lib/trash";
after(()=>pool.end());
test("cashbook deletion requires both actual typed inputs, validates the current locked name and preserves contents on every rejected request",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const temporary=await mkdtemp(join(tmpdir(),"gremio-book-delete-name-")),entry=join(temporary,"action.cjs");
 await build({entryPoints:["app/intern/kassenbuch/actions.ts"],outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"request-context",setup(builder){builder.onResolve({filter:/^@\/lib\/auth$/},()=>({path:"auth",namespace:"test"}));builder.onResolve({filter:/^next\/(navigation|cache)$/},({path})=>({path,namespace:"test"}));builder.onLoad({filter:/.*/,namespace:"test"},({path})=>({contents:path==="auth"?'export async function requireUser(){return globalThis.__deleteBookNameUser;} export async function requireAdmin(){const user=await requireUser();if(user.role!=="admin")throw Error("admin-required");return user;}':'export function revalidatePath(){} export function redirect(){throw Error("redirect")} export function notFound(){throw Error("not-found")}',loader:"js"}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);
 const context=globalThis as unknown as {__deleteBookNameUser?:s.User};
 const [admin,other]=await db.insert(s.users).values([{username:randomUUID(),role:"admin"},{username:randomUUID()}]).returning();
 const [book]=await db.insert(s.cashbooks).values({name:"Kassenbuch ÄÖ & 2026",ownerId:admin.id,config:defaultCashbookConfig}).returning();
 const [posted]=await db.insert(s.cashbookEntries).values({cashbookId:book.id,creatorId:admin.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:{cardId:null,business:true,number:"G1",receiptIds:[],amount:1234,budgetTitle:"1200",holder:"Original",iban:"DE89370400440532013000",bank:"Original",purpose:"",place:"",date:""}}).returning();
 const read=async()=>(await db.select().from(s.cashbooks).where(eq(s.cashbooks.id,book.id)))[0];const originalBook=await read();
 try{
  context.__deleteBookNameUser=admin;
  for(const name of [undefined,"","LÖSCHEN","Falsch",book.name.toLowerCase(),book.name+" ",true,123]){
   const result=await loaded.exports.trashCashbookAction(book.id,"LÖSCHEN",name);assert.match(result.error,/Namen/);assert.deepEqual(await read(),originalBook);assert.deepEqual((await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,posted.id)))[0],posted);
  }
  assert.match((await loaded.exports.trashCashbookAction(book.id,"",book.name)).error,/LÖSCHEN/);
  await assert.rejects(moveToTrash(admin,"cashbook",book.id,"LÖSCHEN"),/Namen/);
  context.__deleteBookNameUser=other;await assert.rejects(loaded.exports.trashCashbookAction(book.id,"LÖSCHEN",book.name),/admin-required/);assert.deepEqual(await read(),originalBook);
  context.__deleteBookNameUser=admin;
  const client=await pool.connect();let pending:Promise<{error?:string}>;
  try{await client.query("BEGIN");await client.query("select id from cashbooks where id=$1 for update",[book.id]);pending=loaded.exports.trashCashbookAction(book.id,"LÖSCHEN",book.name);await new Promise(resolve=>setTimeout(resolve,20));await client.query("update cashbooks set name='Neuer vollständiger Name' where id=$1",[book.id]);await client.query("COMMIT");}finally{client.release();}
  assert.match((await pending!).error!,/Namen/);assert.equal((await read()).deletedAt,null);
  await assert.rejects(loaded.exports.trashCashbookAction(book.id,"LÖSCHEN","Neuer vollständiger Name"),/redirect/);assert.ok((await read()).deletedAt);
  assert.deepEqual((await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,posted.id)))[0],posted);
  const trash=(await pool.query("select id from trash_entries where kind='cashbook' and entity_id=$1 and state='trashed'",[book.id])).rows[0];await restoreTrashEntry(admin,trash.id,"WIEDERHERSTELLEN");assert.equal((await read()).deletedAt,null);
 }finally{
  const current=await read();if(current){const existing=(await pool.query("select id from trash_entries where kind='cashbook' and entity_id=$1 and state='trashed'",[book.id])).rows[0];const id=existing?.id??await moveToTrash(admin,"cashbook",book.id,"LÖSCHEN",{cashbookName:current.name});await purgeTrashEntry(admin,id,"ENDGÜLTIG");}
  for(const user of [admin,other])await db.delete(s.users).where(eq(s.users.id,user.id));delete context.__deleteBookNameUser;await rm(temporary,{recursive:true,force:true});
 }
});
