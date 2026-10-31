// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Explicit integration check. Starts and removes an isolated Keycloak; credentials are synthetic and never printed.
const {execFileSync}=require('node:child_process');const {randomUUID,randomBytes}=require('node:crypto');const {createServer}=require('node:net');const {pathToFileURL}=require('node:url');const {join}=require('node:path');const assert=require('node:assert/strict');
let stage='startup';
(async()=>{
 const image=process.env.GREMIO_KEYCLOAK_TEST_IMAGE;assert.ok(image,'Set GREMIO_KEYCLOAK_TEST_IMAGE to an available local Keycloak image.');
 const name='gremio-sso-check-'+randomUUID().slice(0,8),adminPassword=randomBytes(24).toString('hex'),clientSecret=randomBytes(24).toString('hex'),password=randomBytes(24).toString('hex');
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const host='http://127.0.0.1:'+port;
 execFileSync('docker',['run','-d','--name',name,'-p',`127.0.0.1:${port}:8080`,'-e','KC_BOOTSTRAP_ADMIN_USERNAME=synthetic-admin','-e','KC_BOOTSTRAP_ADMIN_PASSWORD='+adminPassword,image,'start-dev'],{stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<240;i++){try{if((await fetch(host+'/realms/master/.well-known/openid-configuration')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'isolated Keycloak did not start');
  const form=(value)=>new URLSearchParams(value);const grant=async(url,body)=>{const r=await fetch(url,{method:'POST',body:form(body)});if(r.status!==200){const error=await r.json();console.error(JSON.stringify({stage,status:r.status,error:error.error}));}assert.equal(r.status,200);return r.json();};
  const admin=await grant(host+'/realms/master/protocol/openid-connect/token',{client_id:'admin-cli',grant_type:'password',username:'synthetic-admin',password:adminPassword});
  const adminCall=async(path,method,value)=>{const r=await fetch(host+'/admin/'+path,{method,headers:{authorization:'Bearer '+admin.access_token,'content-type':'application/json'},body:value?JSON.stringify(value):undefined});assert.ok(r.ok,'isolated admin operation failed: '+r.status);return r;};
  const realm='gremio-synthetic';await adminCall('realms','POST',{realm,enabled:true,accessTokenLifespan:2});
  await adminCall(`realms/${realm}/clients`,'POST',{clientId:'synthetic-client',enabled:true,publicClient:false,secret:clientSecret,directAccessGrantsEnabled:true,standardFlowEnabled:true,defaultClientScopes:['profile','email'],optionalClientScopes:['offline_access']});
  const created=await adminCall(`realms/${realm}/users`,'POST',{username:'synthetic-person',enabled:true,emailVerified:true,firstName:'Synthetic',lastName:'Test',email:'synthetic@example.invalid',credentials:[{type:'password',value:password,temporary:false}]});const id=created.headers.get('location').split('/').at(-1);
  const offlineRole=await (await adminCall(`realms/${realm}/roles/offline_access`,'GET')).json();await adminCall(`realms/${realm}/users/${id}/role-mappings/realm`,'POST',[offlineRole]);
  process.env.OIDC_ISSUER=host+'/realms/'+realm;delete process.env.OIDC_INTERNAL_ISSUER;process.env.OIDC_CLIENT_ID='synthetic-client';process.env.OIDC_CLIENT_SECRET=clientSecret;
  const {introspectSsoToken}=await import(pathToFileURL(join(process.cwd(),'lib/oidc.ts')).href);
  const login=()=>grant(process.env.OIDC_ISSUER+'/protocol/openid-connect/token',{client_id:'synthetic-client',client_secret:clientSecret,grant_type:'password',username:'synthetic-person',password,scope:'openid profile email offline_access'});
  stage='offline-login';const token=await login();stage='offline-introspection';let checked=await introspectSsoToken(token.refresh_token,'refresh_token');assert.equal(checked.active,true);if(checked.sub!=null)assert.equal(checked.sub,id);assert.equal(checked.token_type?.toLowerCase(),'offline');assert.equal(checked.client_id,'synthetic-client');
  stage='expired-access';await new Promise(r=>setTimeout(r,3000));assert.equal((await introspectSsoToken(token.refresh_token,'refresh_token')).active,true,'offline grant survives short access-token expiry');
  stage='disable';await adminCall(`realms/${realm}/users/${id}`,'PUT',{enabled:false});checked=await introspectSsoToken(token.refresh_token,'refresh_token');assert.equal(checked.active,false);
  stage='reactivate';await adminCall(`realms/${realm}/users/${id}`,'PUT',{enabled:true});const second=await login();assert.equal((await introspectSsoToken(second.refresh_token,'refresh_token')).active,true);
  stage='delete';await adminCall(`realms/${realm}/users/${id}`,'DELETE');assert.equal((await introspectSsoToken(second.refresh_token,'refresh_token')).active,false);
  console.log(JSON.stringify({passed:true,isolatedKeycloak:true,refreshIntrospection:true,offlineSurvivesAccessExpiry:true,disabledRejected:true,deletedRejected:true}));
 }finally{execFileSync('docker',['rm','-f',name],{stdio:'pipe'});}
})().catch(()=>{console.error('Isolated Keycloak verification failed at '+stage+'; no credentials or token bodies printed.');process.exitCode=1;});
