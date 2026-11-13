// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const {Pool}=require('pg');
const argon2=require('@node-rs/argon2');
async function main(){
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=='limen-db'||url.pathname!=='/limen_local_test')throw new Error('Only the isolated local demo database is allowed.');
  if(!process.env.OIDC_CLIENT_SECRET)throw new Error('Missing client secret');
  const pool=new Pool({connectionString:url.href});
  try{
    const hash=await argon2.hash(process.env.OIDC_CLIENT_SECRET,{memoryCost:65536,timeCost:3,parallelism:1});
    await pool.query(`INSERT INTO oauth_clients (client_id,client_secret_hash,name,redirect_uris,post_logout_redirect_uris,allowed_scopes,is_confidential,is_first_party)
      VALUES ($1,$2,$3,$4,$5,$6,true,true)
      ON CONFLICT (client_id) DO UPDATE SET client_secret_hash=EXCLUDED.client_secret_hash,redirect_uris=EXCLUDED.redirect_uris,post_logout_redirect_uris=EXCLUDED.post_logout_redirect_uris,allowed_scopes=EXCLUDED.allowed_scopes`,
      ['gremio-local-test',hash,'Gremio – lokaler Test',['http://localhost:3010/api/auth/callback'],['http://localhost:3010','http://localhost:3010/'],['openid','profile','email','offline_access']]);
    console.log('Local Gremio OIDC client registered.');
  }finally{await pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
