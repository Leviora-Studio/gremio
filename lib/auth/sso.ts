// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { createHash } from "node:crypto";
import { introspectSsoToken, fetchUserInfo } from "@/lib/oidc";
import { env } from "@/lib/env";
import { refreshIdentity } from "./session-identity";
import type { SessionData } from "./session";
export const SSO_CHECK_INTERVAL_MS = 5 * 60_000;
export type SsoStatus = "valid" | "invalid" | "unavailable";
type Entry = { status:SsoStatus; until:number };
// Hashes and short-lived results only, no raw tokens in the cache.
const results = new Map<string,Entry>();
const pending = new Map<string,Promise<SsoStatus>>();
export async function checkSsoSession(session:SessionData, subject:string):Promise<SsoStatus> {
  if(session.authExpiresAt!=null && (!Number.isFinite(session.authExpiresAt) || Date.now()>=session.authExpiresAt))return "invalid";
  const token=session.refreshToken || session.accessToken;
  if (!token || !subject) return "invalid";
  const binding=session.refreshToken ? refreshIdentity(subject,session.refreshToken) : null;
  if(session.ssoSubject!=null && session.ssoSubject!==subject || session.refreshTokenHash!=null && session.refreshTokenHash!==binding?.refreshTokenHash)return "invalid";
  const bound=!!binding && session.ssoSubject===subject && session.refreshTokenHash===binding.refreshTokenHash;
  const hint=session.refreshToken?"refresh_token":"access_token";
  const key=createHash("sha256").update(JSON.stringify([session.userId,subject,hint,token,session.accessToken??""])).digest("hex");
  const now=Date.now();const cached=results.get(key);
  if(cached && now<cached.until)return cached.status;
  const running=pending.get(key);if(running)return running;
  const work=(async():Promise<SsoStatus>=>{
    const value=await introspectSsoToken(token,hint).catch(()=>null);
    let status:SsoStatus="unavailable";
    if(value){
      const offlineWithoutExpiry=hint==="refresh_token" && value.exp===0 && value.token_type?.toLowerCase()==="offline";
      const active=value.active && value.client_id===env.OIDC_CLIENT_ID && (value.exp==null || offlineWithoutExpiry || typeof value.exp==="number" && value.exp*1000>Date.now());
      if(!active) status="invalid";
      else if(value.sub!=null) status=value.sub===subject?"valid":"invalid";
      else if(bound) status="valid";
      else {
        // RFC 7662 makes sub optional (e.g. Keycloak lightweight access tokens).
        // Require an independent live UserInfo identity match, never skip subject validation.
        const identity=await fetchUserInfo(session.accessToken).catch(()=>null);
        status=identity ? identity.sub===subject?"valid":"invalid" : "unavailable";
      }
    }
    const until=status==="valid"?Math.min(now+SSO_CHECK_INTERVAL_MS,session.authExpiresAt??Infinity,typeof value?.exp==="number" && value.exp>0?value.exp*1000:Infinity):now+5000;
    if(results.size>=2000){for(const [id,entry] of results)if(entry.until<=Date.now())results.delete(id);if(results.size>=2000)results.delete(results.keys().next().value!);}
    results.set(key,{status,until});
    return status==="valid" && Date.now()>=until?"unavailable":status;
  })();
  pending.set(key,work);
  try{return await work;}finally{pending.delete(key);}
}
