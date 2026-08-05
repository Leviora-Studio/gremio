// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { clientIpHmac } from "@/lib/client-ip";
import { deriveKey } from "@/lib/crypto";

// Zweckgebundener HMAC-Schlüssel (nicht das rohe AUTH_SECRET) zur IP-Pseudonymisierung.
const IP_HMAC_KEY = deriveKey("rate-limit-ip");

// In-Memory-Ratenbegrenzung (eine App-Instanz; Deployment = ein Container).
// Bewusst ohne Persistenz/Redis — DSGVO: es wird KEINE Roh-IP gespeichert,
// nur ein flüchtiger HMAC-Schlüssel mit kurzer Lebensdauer.

type Bucket = { count: number; resetAt: number };

/**
 * EIN Speicher JE SCOPE-FAMILIE statt einer globalen Map.
 *
 * Vorher teilten sich alle Scopes eine Map mit hartem Deckel: War der voll,
 * lieferte der Limiter für JEDEN Schlüssel ohne laufenden Bucket `false` — also
 * auch für `oidc-login`. Genug verschiedene Quell-IPs (die 24-Stunden-Fenster
 * der Tageslimits räumten sich lange nicht auf) sperrten damit die gesamte
 * Anmeldung aus. Getrennte Speicher machen das strukturell unmöglich: Eine
 * geflutete öffentliche Familie kann interne Familien nicht mehr verdrängen.
 *
 * Die Familie ist der Teil vor dem ersten `:` — `pdf-save:42:‹hmac›` →
 * `pdf-save`, `oidc-login:‹hmac›` → `oidc-login`. Die Menge der Familien stammt
 * ausschließlich aus dem Code und kann nicht wachsen.
 */
const stores = new Map<string, Map<string, Bucket>>();

/**
 * Deckel je Familie. Öffentliche Flächen sehen viele verschiedene IPs und
 * bekommen mehr Platz; interne Familien zählen teils pro Nutzer und brauchen
 * wenig. Die Summe bleibt in derselben Größenordnung wie der alte Gesamtdeckel.
 */
const FAMILY_CAPS: Record<string, number> = {
  // öffentlich (viele fremde IPs)
  "public-api-submit-burst": 10_000,
  "public-api-submit-day": 10_000,
  "public-api-feedback-submit-burst": 10_000,
  "public-api-feedback-submit-day": 10_000,
  "public-api-status": 10_000,
  "public-api-locations": 5_000,
  "public-api-feedback-areas": 5_000,
  submit: 5_000,
  "feedback-submit": 5_000,
  "public-upload": 5_000,
  "public-submit": 5_000,
  "inventory-request": 5_000,
  "inventory-contract": 5_000,
  "oidc-login": 5_000,
};
/** Interne, meist pro Nutzer gezählte Familien (pdf-save, cert-upload, …). */
const DEFAULT_FAMILY_CAP = 2_000;

const warnedFamilies = new Set<string>();

function familyOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

function storeFor(key: string): Map<string, Bucket> {
  const family = familyOf(key);
  let s = stores.get(family);
  if (!s) {
    s = new Map<string, Bucket>();
    stores.set(family, s);
  }
  return s;
}

function pruneStore(store: Map<string, Bucket>, now: number): void {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

/** Abgelaufene Buckets aller Familien entfernen (auch ohne Verkehr). */
export function pruneExpired(now = Date.now()): void {
  for (const [family, store] of stores) {
    pruneStore(store, now);
    if (store.size === 0) stores.delete(family);
  }
}

/**
 * Platz schaffen: erst Abgelaufenes, dann die ÄLTESTEN Einträge verdrängen
 * (`Map` hält die Einfügereihenfolge).
 *
 * Bewusst verdrängen statt abweisen: Wer genug IPs hat, um einen Speicher zu
 * füllen, hat ohnehin *IPs × Limit* Anfragen frei und muss das Limit gar nicht
 * umgehen. „Limit wird weicher" ist ein deutlich besserer Ausfallmodus als
 * „niemand kann sich mehr anmelden".
 */
function makeRoom(key: string, store: Map<string, Bucket>, now: number): void {
  const cap = FAMILY_CAPS[familyOf(key)] ?? DEFAULT_FAMILY_CAP;
  if (store.size < cap) return;
  pruneStore(store, now);
  if (store.size < cap) return;

  const family = familyOf(key);
  if (!warnedFamilies.has(family)) {
    warnedFamilies.add(family);
    console.warn(
      `[rate-limit] Speicher der Familie "${family}" ist voll (${cap} Einträge) — älteste Zähler werden verdrängt. Das Limit wirkt hier vorübergehend schwächer.`,
    );
  }
  // 10 % Luft schaffen, damit nicht bei jeder Anfrage neu verdrängt wird.
  let toEvict = Math.max(1, Math.ceil(cap * 0.1));
  for (const k of store.keys()) {
    if (toEvict-- <= 0) break;
    store.delete(k);
  }
}

/** Gemeinsamer Kern von `rateLimit` und `rateLimitDetailed`. */
function take(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const store = storeFor(key);
  const b = store.get(key);
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
  makeRoom(key, store, now);
  store.set(key, { count: 1, resetAt: now + windowMs });
  return { allowed: true, retryAfterSec: 0 };
}

// Periodisches Aufräumen, damit abgelaufene Zähler auch ohne Verkehr
// verschwinden. `unref()` hält den Prozess nicht am Leben; die Absicherung über
// globalThis verhindert doppelte Timer beim Dev-HMR.
const g = globalThis as unknown as { __rateLimitSweeper?: NodeJS.Timeout };
if (!g.__rateLimitSweeper) {
  g.__rateLimitSweeper = setInterval(() => pruneExpired(), 60_000);
  g.__rateLimitSweeper.unref?.();
}

/** true = erlaubt, false = Limit erreicht. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  return take(key, limit, windowMs).allowed;
}

/**
 * Pseudonymer Client-Schlüssel aus der ECHTEN Client-IP (Herleitung siehe
 * `lib/client-ip.ts`). Die IP wird nur als HMAC (mit einem aus AUTH_SECRET
 * abgeleiteten Unterschlüssel) verwendet, nie im Klartext gespeichert.
 */
export async function clientKey(scope: string): Promise<string> {
  return `${scope}:${await clientIpHmac(IP_HMAC_KEY)}`;
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

/**
 * Einheitliches Limit der ÖFFENTLICHEN Browser-Formulare (Server Actions):
 * 20 Vorgänge pro Minute und IP.
 *
 * Bewusst nicht knapper: Gezählt wird pro IP, und ganze Hochschulen oder
 * Wohnheime teilen sich oft EINE öffentliche Adresse (NAT). 20 Einreichungen
 * in derselben Minute aus einem solchen Netz sind ein realistischer Normalfall,
 * kein Missbrauch. Gegen Bots wirken hier zusätzlich Honeypot und signierte
 * Zeitfalle — das Rate-Limit ist nur der grobe Notnagel gegen Massen-Einsendungen.
 *
 * Die öffentliche API hat eigene, deutlich höhere Limits (siehe lib/public-api.ts);
 * der angemeldete Bereich zählt teils pro Nutzer statt pro IP.
 */
export const FORM_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * Feedback ist die niedrigschwelligste Funktion: kurz getippt, keine Dateien,
 * oft nach einer Sitzung von vielen Leuten gleichzeitig. Deshalb bewusst
 * großzügiger als die übrigen Formulare — dasselbe Limit gilt auch für den
 * API-Weg (siehe RL_FEEDBACK_BURST in lib/public-api.ts).
 */
export const FEEDBACK_FORM_RATE_LIMIT = { limit: 100, windowMs: 60_000 } as const;

/**
 * Prüft das Formular-Limit für den aktuellen Client. Jeder Scope hat einen
 * EIGENEN Zähler — ein ausgeschöpftes Antragsformular blockiert also weder
 * Feedback noch Ausleihe.
 */
export async function allowFormRequest(
  scope: string,
  cfg: { limit: number; windowMs: number } = FORM_RATE_LIMIT,
): Promise<boolean> {
  return allowRequest(scope, cfg.limit, cfg.windowMs);
}

export type RateLimitResult = {
  allowed: boolean;
  /** Sekunden bis zum Zurücksetzen des Fensters (nur bei allowed=false sinnvoll). */
  retryAfterSec: number;
};

/**
 * Wie `rateLimit`, liefert bei Ablehnung zusätzlich die Wartezeit — die
 * JSON-API setzt daraus `Retry-After`. Nutzt denselben Speicher und denselben
 * Kern; beide Varianten verhalten sich damit zwangsläufig gleich.
 */
export function rateLimitDetailed(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  return take(key, limit, windowMs);
}

/** Nur für Tests: setzt alle Zähler zurück. */
export function __resetRateLimitForTests(): void {
  stores.clear();
  warnedFamilies.clear();
}

/** Komfort-Variante von `rateLimitDetailed` für den aktuellen Client. */
export async function allowRequestDetailed(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return rateLimitDetailed(await clientKey(scope), limit, windowMs);
}
