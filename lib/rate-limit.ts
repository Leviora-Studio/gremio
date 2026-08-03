// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { deriveKey } from "@/lib/crypto";

// Zweckgebundener HMAC-Schlüssel (nicht das rohe AUTH_SECRET) zur IP-Pseudonymisierung.
const IP_HMAC_KEY = deriveKey("rate-limit-ip");

// In-Memory-Ratenbegrenzung (eine App-Instanz; Deployment = ein Container).
// Bewusst ohne Persistenz/Redis — DSGVO: es wird KEINE Roh-IP gespeichert,
// nur ein flüchtiger HMAC-Schlüssel mit kurzer Lebensdauer.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000; // harte Obergrenze gegen Heap-Exhaustion

function pruneExpired(now: number): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** true = erlaubt, false = Limit erreicht. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (b && b.resetAt > now) {
    if (b.count >= limit) return false;
    b.count++;
    return true;
  }
  // Neuer/abgelaufener Bucket — Speicher beschränken (fail-closed als Backstop).
  if (buckets.size >= MAX_BUCKETS) {
    pruneExpired(now);
    if (buckets.size >= MAX_BUCKETS) return false;
  }
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return true;
}

/**
 * Pseudonymer Client-Schlüssel aus der ECHTEN Client-IP. Hinter genau einem
 * vertrauenswürdigen nginx ist das `X-Real-IP` (= $remote_addr) bzw. der
 * LETZTE X-Forwarded-For-Eintrag (den nginx anhängt) — NICHT der erste, den
 * der Client selbst fälschen könnte. Die IP wird nur als HMAC (mit einem aus
 * AUTH_SECRET abgeleiteten Unterschlüssel) gespeichert, nie im Klartext.
 */
export async function clientKey(scope: string): Promise<string> {
  const h = await headers();
  const realIp = h.get("x-real-ip")?.trim();
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = realIp || hops[hops.length - 1] || "unknown";
  const mac = createHmac("sha256", IP_HMAC_KEY)
    .update(ip)
    .digest("hex")
    .slice(0, 24);
  return `${scope}:${mac}`;
}

/**
 * Komfort: prüft das Limit für den aktuellen Client. Gibt true zurück, wenn
 * die Anfrage erlaubt ist.
 */
export async function allowRequest(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  return rateLimit(await clientKey(scope), limit, windowMs);
}

export type RateLimitResult = {
  allowed: boolean;
  /** Sekunden bis zum Zurücksetzen des Fensters (nur bei allowed=false sinnvoll). */
  retryAfterSec: number;
};

/**
 * Wie `rateLimit`, liefert bei Ablehnung zusätzlich die Wartezeit — die
 * JSON-API setzt daraus `Retry-After`. Nutzt denselben Bucket-Speicher;
 * das Verhalten von `rateLimit` bleibt unverändert.
 */
export function rateLimitDetailed(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (b && b.resetAt > now) {
    if (b.count >= limit) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
      };
    }
    b.count++;
    return { allowed: true, retryAfterSec: 0 };
  }
  if (buckets.size >= MAX_BUCKETS) {
    pruneExpired(now);
    if (buckets.size >= MAX_BUCKETS) {
      // Fail-closed als Backstop (wie rateLimit) — kurze Wartezeit vorschlagen.
      return { allowed: false, retryAfterSec: 60 };
    }
  }
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return { allowed: true, retryAfterSec: 0 };
}

/** Komfort-Variante von `rateLimitDetailed` für den aktuellen Client. */
export async function allowRequestDetailed(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return rateLimitDetailed(await clientKey(scope), limit, windowMs);
}
