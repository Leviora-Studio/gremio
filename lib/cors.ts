// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

/**
 * Optionale CORS-Freigabe für die öffentliche API (`/api/public/v1`) und die
 * Bearer-Token-API (`/api/v1`).
 *
 * Gesteuert ausschließlich über `CORS_ALLOWED_ORIGINS`: eine Liste exakter
 * HTTP(S)-Origins, getrennt durch Kommas oder Leerzeichen. Leer bzw. nicht
 * gesetzt = keine CORS-Header (bisheriges Verhalten).
 *
 * Bewusste Grenzen:
 * - Kein Platzhalter `*` und keine Muster — nur exakt gelistete Origins.
 * - NIE `Access-Control-Allow-Credentials`: Beide APIs authentifizieren nicht
 *   über Cookies (öffentlich gar nicht, intern per `Authorization`-Header). Ein
 *   Browser schickt cross-origin also keine Gremio-Sitzung mit; eine
 *   freigegebene Seite erhält keine Rechte, die sie nicht selbst mitbringt.
 * - Sessionrouten, Server Actions, Statusseiten, Datei-Downloads sowie MCP und
 *   OAuth liegen außerhalb dieser Präfixe und bleiben unverändert.
 *
 * Ausgewertet wird das in `middleware.ts` (Node-Runtime), damit ein vorgebautes
 * Docker-Image die Variable zur Laufzeit aus der `.env` übernimmt.
 */

export const CORS_ALLOWED_ORIGINS_ENV = "CORS_ALLOWED_ORIGINS";

export type CorsScope = "public" | "internal";

export type CorsOriginList =
  | { ok: true; origins: ReadonlySet<string> }
  | { ok: false; errors: string[] };

/** Wie lange Browser eine erfolgreiche Preflight-Antwort zwischenspeichern. */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

const SCOPE_RULES: Record<
  CorsScope,
  { methods: string; allowHeaders: string; exposeHeaders: string }
> = {
  public: {
    methods: "GET, POST, OPTIONS",
    allowHeaders: "Content-Type, Idempotency-Key",
    exposeHeaders: "Retry-After",
  },
  internal: {
    methods: "GET, POST, PATCH, DELETE, OPTIONS",
    allowHeaders: "Authorization, Content-Type",
    exposeHeaders: "Retry-After, Content-Disposition",
  },
};

/** Normalisiert einen konfigurierten Eintrag zur Origin oder liefert den Fehler. */
function configuredOrigin(entry: string): { origin: string } | { error: string } {
  // Auch `https://*.example.org` abweisen: Der URL-Parser hielte es für einen
  // Hostnamen, es würde aber nie passen und nur ein Muster vortäuschen.
  if (entry.includes("*")) {
    return {
      error: `„${entry}“: Platzhalter (*) sind nicht erlaubt — erlaubte Origins einzeln angeben (z. B. https://www.example.org)`,
    };
  }
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return { error: `„${entry}“ ist keine gültige URL` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `„${entry}“ muss http oder https verwenden` };
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    return {
      error: `„${entry}“ muss eine reine Origin ohne Zugangsdaten, Pfad, Query oder Fragment sein`,
    };
  }
  // `URL.origin` vereinheitlicht Groß-/Kleinschreibung, Standardports, einen
  // abschließenden Schrägstrich und IDN (Punycode) — genau so, wie Browser den
  // `Origin`-Header serialisieren.
  return { origin: url.origin };
}

/** Prüft und normalisiert den Wert von `CORS_ALLOWED_ORIGINS`. */
export function parseCorsAllowedOrigins(raw: string | undefined): CorsOriginList {
  const origins = new Set<string>();
  const errors: string[] = [];
  for (const entry of (raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const result = configuredOrigin(entry);
    if ("origin" in result) origins.add(result.origin);
    else errors.push(result.error);
  }
  return errors.length ? { ok: false, errors } : { ok: true, origins };
}

const NONE: ReadonlySet<string> = new Set();
let cached: { raw: string | undefined; origins: ReadonlySet<string> } | null =
  null;

/**
 * Die aktuell freigegebenen Origins. Ein ungültiger Wert schaltet CORS ab
 * (fail closed) und wird geloggt; zusätzlich verhindert die Validierung in
 * `lib/env.ts`, dass der Server damit überhaupt regulär startet.
 */
export function configuredCorsOrigins(
  raw: string | undefined = process.env[CORS_ALLOWED_ORIGINS_ENV],
): ReadonlySet<string> {
  if (cached && cached.raw === raw) return cached.origins;
  const parsed = parseCorsAllowedOrigins(raw);
  if (!parsed.ok) {
    console.error(
      `❌ ${CORS_ALLOWED_ORIGINS_ENV} ist ungültig, CORS bleibt deaktiviert:`,
      parsed.errors.join("; "),
    );
  }
  cached = { raw, origins: parsed.ok ? parsed.origins : NONE };
  return cached.origins;
}

/** Welche API ein Pfad betrifft — `null` für alles, was CORS nie erhält. */
export function corsScopeForPath(pathname: string): CorsScope | null {
  if (pathname === "/api/public/v1" || pathname.startsWith("/api/public/v1/"))
    return "public";
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/"))
    return "internal";
  return null;
}

export type CorsPlan =
  /** CORS ist aus oder der Pfad ist nicht betroffen: nichts verändern. */
  | { kind: "pass" }
  /** Erlaubter Preflight: sofort mit 204 und diesen Headern antworten. */
  | { kind: "preflight"; headers: Record<string, string> }
  /** Normale Anfrage weiterreichen und diese Header an die Antwort hängen. */
  | { kind: "annotate"; headers: Record<string, string> };

/**
 * Entscheidet über die CORS-Behandlung einer Anfrage. Der `Origin`-Header wird
 * exakt verglichen; Browser senden ihn bereits serialisiert. `null` (Sandbox,
 * `file:`) und abweichende Schreibweisen werden nie freigegeben.
 */
export function planCors(input: {
  method: string;
  pathname: string;
  headers: Headers;
  allowed: ReadonlySet<string>;
}): CorsPlan {
  const scope = corsScopeForPath(input.pathname);
  if (!scope || input.allowed.size === 0) return { kind: "pass" };

  const preflight =
    input.method === "OPTIONS" &&
    input.headers.has("origin") &&
    input.headers.has("access-control-request-method");
  // Auch abgelehnte Antworten variieren nach Origin, damit kein Cache eine
  // freigegebene Antwort an eine andere Seite ausliefert (oder umgekehrt).
  const vary = preflight
    ? "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
    : "Origin";

  const origin = input.headers.get("origin");
  if (!origin || !input.allowed.has(origin)) {
    return { kind: "annotate", headers: { Vary: vary } };
  }

  const rules = SCOPE_RULES[scope];
  if (preflight) {
    return {
      kind: "preflight",
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": rules.methods,
        "Access-Control-Allow-Headers": rules.allowHeaders,
        "Access-Control-Max-Age": String(CORS_PREFLIGHT_MAX_AGE_SECONDS),
        Vary: vary,
      },
    };
  }
  return {
    kind: "annotate",
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": rules.exposeHeaders,
      Vary: vary,
    },
  };
}
