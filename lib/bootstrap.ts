// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ensureCardChangeTrigger } from "@/lib/realtime";
import { startDoneArchiveScheduler } from "@/lib/done-archive";
import { startArchiveRetryScheduler } from "@/lib/archive";
import { isPublicHost } from "@/lib/url-guard";

let done = false;

/**
 * Verhindert, dass die Build-Platzhalter-Secrets versehentlich produktiv
 * verwendet werden (läuft nur beim Serverstart, nicht beim Build).
 */
function assertNoPlaceholderSecrets(): void {
  if (/^0+$/.test(env.ENCRYPTION_KEY)) {
    throw new Error(
      "ENCRYPTION_KEY ist nur Nullen (Build-Platzhalter). Bitte echten Schlüssel in .env setzen: openssl rand -hex 32",
    );
  }
  if (env.AUTH_SECRET.startsWith("build-time-placeholder")) {
    throw new Error(
      "AUTH_SECRET ist noch der Build-Platzhalter. Bitte echten Wert in .env setzen: openssl rand -base64 48",
    );
  }
  if (env.AUTH_SECRET.includes("bitte-aendern")) {
    throw new Error(
      "AUTH_SECRET ist noch der .env.example-Platzhalter. Bitte echten Wert setzen: openssl rand -base64 48",
    );
  }
}

/**
 * In Produktion müssen die SSO-Endpunkte über TLS laufen: Über sie gehen
 * Auth-Code, `client_secret` und Access-/ID-Tokens. http zu einem ÖFFENTLICHEN
 * Host würde diese im Klartext über das Internet schicken. http zu lokalen/
 * privaten Hosts (localhost, host.docker.internal, interne Service-Namen,
 * private IPs) bleibt erlaubt — vertrauenswürdiges Netz, analog DB ohne TLS.
 */
function assertSecureSsoInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  const isLocalOrPrivate = (hostname: string): boolean =>
    hostname === "host.docker.internal" || !isPublicHost(hostname);
  const check = (label: string, raw: string | undefined): void => {
    if (!raw) return;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return; // ungültige URL fängt die env-Validierung separat ab
    }
    if (u.protocol === "http:" && !isLocalOrPrivate(u.hostname)) {
      throw new Error(
        `${label} nutzt http zu einem öffentlichen Host (${u.hostname}). In Produktion müssen SSO-Endpunkte https sein — sonst gehen Auth-Code, client_secret und Tokens im Klartext über das Internet.`,
      );
    }
  };
  check("OIDC_ISSUER", env.OIDC_ISSUER);
  check("OIDC_INTERNAL_ISSUER", env.OIDC_INTERNAL_ISSUER);
}

/**
 * Beim Produktions-Start werden NUR die Drizzle-Migrationen angewendet (Schema).
 * Es werden bewusst KEINE Stammdaten automatisch angelegt — eine neue Instanz
 * startet mit leerer Datenbank: keine Standorte, keine Prioritäten, keine
 * Templates, keine Konten.
 *
 * Startwerte sind optional und werden nur auf ausdrückliche Anweisung erzeugt:
 *   npm run db:seed     (4 Standorte, Prioritäten, Board-Template „Antragsboard")
 *   npm run db:setup    (= db:migrate + db:seed)
 *
 * Nutzerkonten kommen via SSO (JIT-Provisioning beim Login); der in ADMIN_USER
 * konfigurierte Benutzer wird beim ersten Login automatisch Admin.
 */
export async function runStartupBootstrap(): Promise<void> {
  if (done) return;
  done = true;

  assertNoPlaceholderSecrets();
  assertSecureSsoInProduction();
  await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  // Realtime: NOTIFY-Trigger auf `cards` sicherstellen (idempotent).
  await ensureCardChangeTrigger();
  // Done-Spalten-Archivierung: Minuten-Scheduler starten.
  startDoneArchiveScheduler();
  // Nextcloud-Archiv-Retry: fehlgeschlagene Uploads periodisch wiederholen.
  startArchiveRetryScheduler();
  console.log("[bootstrap] Migrationen angewendet (kein Auto-Seed).");
}
