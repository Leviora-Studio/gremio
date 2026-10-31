// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Local-only provider for browser fixtures. The app still performs real HTTP introspection.
const http=require('node:http');
exports.startSyntheticSso=async()=>{
 let issuer;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/.well-known/openid-configuration')){res.end(JSON.stringify({authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',end_session_endpoint:issuer+'/logout',introspection_endpoint:issuer+'/introspect',revocation_endpoint:issuer+'/revoke',userinfo_endpoint:issuer+'/userinfo'}));return;}
  if(req.url.endsWith('/introspect')){
   if(req.headers.authorization!=='Basic '+Buffer.from(process.env.OIDC_CLIENT_ID+':'+process.env.OIDC_CLIENT_SECRET).toString('base64')){res.statusCode=401;res.end('{}');return;}
   let text='';for await(const chunk of req)text+=chunk;const token=new URLSearchParams(text).get('token')??'';
   res.end(JSON.stringify(/^synthetic:\d+$/.test(token)?{active:true,sub:token,client_id:process.env.OIDC_CLIENT_ID,exp:Math.floor(Date.now()/1000)+3600}:{active:false}));return;
  }
  res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));issuer='http://127.0.0.1:'+server.address().port+'/synthetic-sso';
 return {issuer,session:userId=>({userId,sessionVersion:0,refreshToken:'synthetic:'+userId}),close:()=>new Promise(r=>server.close(r))};
};
