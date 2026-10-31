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
import { refreshIdentity, SESSION_TTL_SECONDS } from "../lib/auth/session-identity";

test("SSO introspection is cached for at most five minutes, fails closed on outages and binds subject/client/expiry",async t=>{
 const output=await mkdtemp(join(tmpdir(),"gremio-sso-check-")),entry=join(output,"check.cjs");
 const context=globalThis as unknown as {__ssoCalls:number;__ssoValue:unknown;__ssoIdentity:unknown;__ssoIdentityCalls:number};context.__ssoCalls=0;context.__ssoIdentityCalls=0;context.__ssoIdentity=null;
 await build({entryPoints:[join(process.cwd(),"lib/auth/sso.ts")],outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"fake-provider",setup(b){b.onResolve({filter:/^@\/lib\/oidc$/},()=>({path:"provider",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:'export async function introspectSsoToken(){globalThis.__ssoCalls++;return globalThis.__ssoValue} export async function fetchUserInfo(){globalThis.__ssoIdentityCalls++;return globalThis.__ssoIdentity}',loader:"js"}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);
 const {checkSsoSession,SSO_CHECK_INTERVAL_MS}=loaded.exports;
 const session={userId:1,refreshToken:"synthetic-refresh",accessToken:"synthetic-expired-access"};const good={active:true,sub:"subject",client_id:process.env.OIDC_CLIENT_ID,exp:Math.floor(Date.now()/1000)+3600};
 t.mock.timers.enable({apis:["Date"],now:Date.now()});
 try{
  context.__ssoValue=good;
  assert.equal(await checkSsoSession(session,"subject"),"valid");assert.equal(await checkSsoSession(session,"subject"),"valid");assert.equal(context.__ssoCalls,1);
  context.__ssoValue={active:false};t.mock.timers.tick(SSO_CHECK_INTERVAL_MS-1);assert.equal(await checkSsoSession(session,"subject"),"valid");t.mock.timers.tick(1);assert.equal(await checkSsoSession(session,"subject"),"invalid");assert.equal(context.__ssoCalls,2);
  context.__ssoValue=good;assert.equal(await checkSsoSession({...session,refreshToken:"outage-token"},"subject"),"valid");
  context.__ssoValue=null;t.mock.timers.tick(SSO_CHECK_INTERVAL_MS);assert.equal(await checkSsoSession({...session,refreshToken:"outage-token"},"subject"),"unavailable");
  context.__ssoValue=good;assert.equal(await checkSsoSession({...session,refreshToken:"outage-token"},"subject"),"unavailable");t.mock.timers.tick(5000);assert.equal(await checkSsoSession({...session,refreshToken:"outage-token"},"subject"),"valid");
  for(const [token,value] of [["wrong-user",{...good,sub:"other"}],["wrong-client",{...good,client_id:"other"}],["expired",{...good,exp:1}],["inactive",{active:false}]]){context.__ssoValue=value;assert.equal(await checkSsoSession({...session,refreshToken:token},"subject"),"invalid");}
  assert.equal(await checkSsoSession({userId:1},"subject"),"invalid");
  context.__ssoValue={active:true,client_id:process.env.OIDC_CLIENT_ID};context.__ssoIdentity={sub:"subject"};
  assert.equal(await checkSsoSession({userId:1,accessToken:"lightweight"},"subject"),"valid");assert.equal(context.__ssoIdentityCalls,1);
  context.__ssoIdentity={sub:"someone-else"};assert.equal(await checkSsoSession({userId:1,accessToken:"lightweight-wrong-user"},"subject"),"invalid");
  context.__ssoIdentity=null;assert.equal(await checkSsoSession({userId:1,accessToken:"lightweight-outage"},"subject"),"unavailable");
  context.__ssoValue={...good,sub:"other"};context.__ssoIdentity={sub:"subject"};const identityCalls=context.__ssoIdentityCalls;
  assert.equal(await checkSsoSession({userId:1,accessToken:"explicit-wrong-sub"},"subject"),"invalid");assert.equal(context.__ssoIdentityCalls,identityCalls,"an explicit subject mismatch cannot be overridden by UserInfo");
  const before=context.__ssoCalls;context.__ssoValue=good;await Promise.all(Array.from({length:10},()=>checkSsoSession({...session,refreshToken:"parallel"},"subject")));assert.equal(context.__ssoCalls,before+1);
  // Offline authorization survives access-token expiry; five minutes is a check interval, not a login lifetime.
  const deadline=Date.now()+SESSION_TTL_SECONDS*1000;
  const offline={userId:1,refreshToken:"stable-offline-token",...refreshIdentity("subject","stable-offline-token"),authExpiresAt:deadline};
  context.__ssoValue={active:true,client_id:process.env.OIDC_CLIENT_ID,token_type:"Offline",exp:0};context.__ssoIdentity=null;
  const userinfoBefore=context.__ssoIdentityCalls;
  assert.equal(await checkSsoSession(offline,"subject"),"valid");const checksBefore=context.__ssoCalls;
  t.mock.timers.tick(SSO_CHECK_INTERVAL_MS);assert.equal(await checkSsoSession(offline,"subject"),"valid");assert.equal(context.__ssoCalls,checksBefore+1);assert.equal(context.__ssoIdentityCalls,userinfoBefore);
  assert.equal(await checkSsoSession({...offline,refreshToken:"substituted-token"},"subject"),"invalid");
  context.__ssoValue={active:false};t.mock.timers.tick(SSO_CHECK_INTERVAL_MS);assert.equal(await checkSsoSession(offline,"subject"),"invalid","offline access never bypasses an SSO revocation");
  context.__ssoValue={active:true,sub:"subject",client_id:process.env.OIDC_CLIENT_ID};
  t.mock.timers.tick(deadline-Date.now()-1);assert.equal(await checkSsoSession(offline,"subject"),"valid");t.mock.timers.tick(1);assert.equal(await checkSsoSession(offline,"subject"),"invalid","the 14-day deadline is absolute");
 }finally{t.mock.timers.reset();await rm(output,{recursive:true,force:true});}
});
