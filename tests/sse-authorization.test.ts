// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
test("protected SSE rechecks heartbeats and events, closes on denial, and keeps public streams unchanged",async t=>{
 const dir=await mkdtemp(join(tmpdir(),"gremio-sse-auth-")),entry=join(dir,"sse.cjs");
 const state=globalThis as unknown as {__streamListener?:(c:unknown)=>void;__streamUnsubscribes:number};state.__streamUnsubscribes=0;
 await build({entryPoints:[join(process.cwd(),"lib/sse.ts")],outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"notifications",setup(b){b.onResolve({filter:/^@\/lib\/realtime$/},()=>({path:"notifications",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({loader:"js",contents:'export function subscribeCardChanges(cb){globalThis.__streamListener=cb;return ()=>{globalThis.__streamUnsubscribes++;}} export const subscribeInventoryChanges=subscribeCardChanges;'}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);const {cardChangeSSE}=loaded.exports;
 t.mock.timers.enable({apis:["setInterval"]});
 try{
  for(const kind of ["heartbeat","event"]){let allowed=true;const response=cardChangeSSE(new AbortController().signal,()=>true,async()=>allowed);const reader=response.body.getReader();await reader.read();await reader.read();allowed=false;if(kind==="heartbeat")t.mock.timers.tick(25000);else state.__streamListener!({boardId:1});assert.equal((await reader.read()).done,true);}
  const controller=new AbortController();const response=cardChangeSSE(controller.signal,()=>true);const reader=response.body.getReader();await reader.read();await reader.read();state.__streamListener!({boardId:1});assert.equal(new TextDecoder().decode((await reader.read()).value),"data: change\n\n");controller.abort();assert.equal((await reader.read()).done,true);assert.equal(state.__streamUnsubscribes,3);
 }finally{t.mock.timers.reset();await rm(dir,{recursive:true,force:true});}
});
