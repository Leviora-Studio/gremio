// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../lib/db";
import {users,boards} from "../lib/db/schema";
after(()=>pool.end());
test("admin deactivation blocks existing sessions, preserves contents and requires fresh login on reactivation",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const dir=await mkdtemp(join(tmpdir(),"gremio-deactivation-")),entry=join(dir,"test.cjs");
 const context=globalThis as unknown as {__ssoSession:{userId?:number;sessionVersion?:number;refreshToken?:string};__revokedSubjects:Set<string>};context.__revokedSubjects=new Set();
 await build({stdin:{contents:`export * from ${JSON.stringify(join(process.cwd(),"lib/auth/index.ts"))};export * from ${JSON.stringify(join(process.cwd(),"app/admin/users/actions.ts"))};`,resolveDir:process.cwd()},outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"context",setup(b){
 b.onResolve({filter:/^(\.\/session|@\/lib\/auth\/session)$/},()=>({path:"session",namespace:"mock"}));
 b.onResolve({filter:/^@\/lib\/oidc$/},()=>({path:"oidc",namespace:"mock"}));
 b.onResolve({filter:/^next\/(navigation|cache)$/},()=>({path:"next",namespace:"mock"}));
 b.onLoad({filter:/.*/,namespace:"mock"},({path})=>({loader:"js",contents:path==="session"?'export async function getSession(){return globalThis.__ssoSession} export async function saveSession(s){await s.save()}':path==="oidc"?'export async function introspectSsoToken(token){const sub=token.slice(6);return {active:!globalThis.__revokedSubjects.has(sub),sub,client_id:process.env.OIDC_CLIENT_ID}} export async function fetchUserInfo(){return null}':'export function redirect(url){throw Error("redirect:"+url)} export function revalidatePath(){}'}));
 }}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);const api=loaded.exports;
 const people=await db.insert(users).values([{username:randomUUID(),sub:randomUUID(),role:"admin"},{username:randomUUID(),sub:randomUUID(),role:"user"},{username:randomUUID(),sub:randomUUID(),role:"user"}]).returning();const [admin,target,other]=people;
 const session=(u:typeof admin,version=u.sessionVersion)=>({userId:u.id,sessionVersion:version,refreshToken:`token:${u.sub}`});
 let boardId:number|undefined;
 try{
  [boardId]= (await db.insert(boards).values({name:"Preserved board",ownerId:target.id}).returning({id:boards.id})).map(r=>r.id);
  context.__ssoSession=session(target);assert.equal((await api.getCurrentUser()).id,target.id);await assert.rejects(api.setUserActiveAction(other.id,false),/redirect:\/intern/);
  context.__ssoSession=session(admin);assert.ok((await api.setUserActiveAction(admin.id,false)).error);assert.ok((await api.setUserActiveAction(target.id,false)).success);
  const disabled=(await db.select().from(users).where(eq(users.id,target.id)))[0];assert.equal(disabled.isActive,false);assert.equal(disabled.sessionVersion,1);
  assert.equal((await db.select().from(boards).where(eq(boards.id,boardId!))).length,1);
  context.__ssoSession=session(target);assert.equal(await api.getCurrentUser(),null);
  context.__ssoSession=session(admin);assert.ok((await api.setUserActiveAction(target.id,true)).success);
  context.__ssoSession=session(target);assert.equal(await api.getCurrentUser(),null,"reactivation never revives old cookies");
  context.__ssoSession=session(target,2);assert.equal((await api.getCurrentUser()).id,target.id);
  const rejected=session(other);rejected.refreshToken="token:wrong-subject";assert.equal(await api.resolveSessionUser(rejected),null);
 }finally{if(boardId)await db.delete(boards).where(eq(boards.id,boardId));await db.delete(users).where(inArray(users.id,people.map(u=>u.id)));await rm(dir,{recursive:true,force:true});}
});
