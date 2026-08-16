// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { createHmac } from "node:crypto";
import { headers } from "next/headers";

/**
 * Pseudonyme Kennung des aufrufenden Clients.
 *
 * Eigenes Modul, weil inzwischen zwei Schutzmaßnahmen dieselbe Herleitung
 * brauchen: das Rate-Limit (`lib/rate-limit.ts`) und die signierte Zeitfalle
 * der öffentlichen Formulare (`lib/antispam.ts`). Zwei Kopien derselben
 * Header-Auswertung würden früher oder später auseinanderlaufen — und diese
 * Auswertung ist sicherheitsrelevant.
 *
 * Hinter genau einem vertrauenswürdigen nginx ist die echte Client-IP
 * `X-Real-IP` (= `$remote_addr`) bzw. der LETZTE `X-Forwarded-For`-Eintrag (den
 * nginx anhängt) — NICHT der erste, den der Client selbst fälschen könnte.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const realIp = h.get("x-real-ip")?.trim();
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return realIp || hops[hops.length - 1] || "unknown";
}

/**
 * HMAC der Client-IP. Die IP selbst wird nie gespeichert oder weitergegeben
 * (DSGVO). Der Schlüssel kommt vom Aufrufer und ist zweckgebunden (`deriveKey`),
 * damit ein Wert aus dem einen Zweck nichts über den anderen verrät — und wird
 * dort einmalig beim Modulstart abgeleitet statt bei jeder Anfrage.
 */
export async function clientIpHmac(key: Buffer): Promise<string> {
  return createHmac("sha256", key)
    .update(await clientIp())
    .digest("hex")
    .slice(0, 24);
}
