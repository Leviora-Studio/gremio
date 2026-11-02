// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { SESSION_TTL_SECONDS } from "../lib/auth/session-identity";
test("session cookie lasts 14 days and profile writes never extend the original login deadline",async t=>{
 const dir=await mkdtemp(join(tmpdir(),"gremio-session-lifetime-")),entry=join(dir,"session.cjs");
 const state=globalThis as unknown as {__lifetimeCookie?:string;__lifetimeOptions?:{maxAge:number}};
 await build({entryPoints:[join(process.cwd(),"lib/auth/session.ts")],outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"cookie-context",setup(b){b.onResolve({filter:/^next\/headers$/},()=>({path:"headers",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({loader:"js",contents:'export async function headers(){return new Headers({host:"127.0.0.1"})} export async function cookies(){return {get(){return globalThis.__lifetimeCookie?{value:globalThis.__lifetimeCookie}:undefined},set(name,value,options){globalThis.__lifetimeCookie=value;globalThis.__lifetimeOptions=options}}}'}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);
 t.mock.timers.enable({apis:["Date"],now:Date.now()});
 try{
  const session=await loaded.exports.getSession();const deadline=Date.now()+SESSION_TTL_SECONDS*1000;
  Object.assign(session,{userId:1,authExpiresAt:deadline,refreshToken:"synthetic-offline-token",ssoSubject:"synthetic-subject",idToken:"x".repeat(3000)});
  await loaded.exports.saveSession(session);assert.equal(state.__lifetimeOptions!.maxAge,SESSION_TTL_SECONDS);assert.ok(state.__lifetimeCookie!.length<4096);assert.equal(session.idToken,undefined);
  t.mock.timers.tick(12*60*60*1000);session.idToken="synthetic-id-token";await loaded.exports.saveSession(session);
  assert.equal(state.__lifetimeOptions!.maxAge,SESSION_TTL_SECONDS-12*60*60);const read=await loaded.exports.getSession();assert.equal(read.authExpiresAt,deadline);assert.equal(read.refreshToken,"synthetic-offline-token");
  const accessDeadline=Date.now()+60_000;
  Object.assign(read,{authExpiresAt:accessDeadline,accessToken:"synthetic-access-only",refreshToken:undefined});
  await loaded.exports.saveSession(read);assert.equal(state.__lifetimeOptions!.maxAge,60);
  t.mock.timers.tick(30_000);await loaded.exports.saveSession(read);
  assert.equal(state.__lifetimeOptions!.maxAge,30);assert.equal(read.authExpiresAt,accessDeadline);
 }finally{t.mock.timers.reset();delete state.__lifetimeCookie;await rm(dir,{recursive:true,force:true});}
});
