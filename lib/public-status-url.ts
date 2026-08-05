// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { TOKEN_ALPHABET, TOKEN_LENGTH } from "@/lib/constants";
import { appBaseUrl } from "@/lib/public-api";

/**
 * Zerlegt einen öffentlichen Status-Link in Typ und Token.
 *
 * SICHERHEIT — die übergebene URL wird NIEMALS abgerufen: kein `fetch`, kein
 * Redirect, kein DNS-Lookup. Sie wird ausschließlich lokal geparst, strukturell
 * gegen `APP_BASE_URL` geprüft und dann nur noch als Token weiterverwendet. Der
 * Datenzugriff erfolgt gegen die eigene Datenbank. Damit ist der Endpunkt kein
 * SSRF-Hebel, obwohl er eine URL entgegennimmt.
 */

/** Großzügig, aber begrenzt — ein Status-Link braucht ~60 Zeichen. */
export const MAX_STATUS_URL_LENGTH = 2048;

export type StatusLinkKind = "application" | "feedback";

export type ParsedStatusLink =
  | { ok: true; kind: StatusLinkKind; token: string }
  | { ok: false; reason: "missing" | "malformed" | "origin" | "path" };

// Genau die zwei unterstützten Formen. `/inventar/status/{token}` ist bewusst
// NICHT dabei (eigener Vorgangstyp mit anderer Fachlogik), ebenso wenig PDF-,
// Attachment- oder Stream-Pfade.
const PATH_PATTERNS: { re: RegExp; kind: StatusLinkKind }[] = [
  { re: /^\/status\/([^/]+)$/, kind: "application" },
  { re: /^\/feedback\/status\/([^/]+)$/, kind: "feedback" },
];

const tokenRe = new RegExp(`^[${TOKEN_ALPHABET.replace(/[-\\\]]/g, "\\$&")}]{${TOKEN_LENGTH}}$`);

/** Entspricht der Token exakt dem erzeugten Format (Alphabet und Länge)? */
export function isValidStatusToken(token: string): boolean {
  return tokenRe.test(token);
}

export function parseStatusLink(raw: unknown): ParsedStatusLink {
  if (typeof raw !== "string") return { ok: false, reason: "missing" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "missing" };
  if (value.length > MAX_STATUS_URL_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  let url: URL;
  let base: URL;
  try {
    url = new URL(value);
    base = new URL(appBaseUrl());
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Zugangsdaten in der URL sind nie legitim und ein klassischer Trick, um
  // Origin-Prüfungen zu verwirren (https://gremio.example@evil.test/…).
  if (url.username || url.password) return { ok: false, reason: "origin" };

  // Origin STRUKTURELL vergleichen — kein startsWith auf dem String, das
  // „https://gremio.example.evil.test" durchlassen würde. `URL.origin` deckt
  // Protokoll, Hostname und Port ab; der Port wird zusätzlich explizit
  // verglichen, weil `origin` den Standardport weglässt.
  if (url.protocol !== base.protocol) return { ok: false, reason: "origin" };
  if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) {
    return { ok: false, reason: "origin" };
  }
  if (url.port !== base.port) return { ok: false, reason: "origin" };

  // Query und Fragment sind bei einem Status-Link nie sinnvoll und könnten
  // Tracking-Parameter einschleusen.
  if (url.search || url.hash) return { ok: false, reason: "path" };

  // `URL` normalisiert `.` und `..` bereits weg; ein Pfad mit zusätzlichen
  // Segmenten fällt danach durch die exakten Muster.
  const path = url.pathname;
  for (const p of PATH_PATTERNS) {
    const m = p.re.exec(path);
    if (!m) continue;
    // decodeURIComponent wirft bei kaputter Prozent-Kodierung („%ZZ", „%").
    // Ohne dieses catch würde ein solcher Link eine unbehandelte Ausnahme und
    // damit 500 statt 400 erzeugen — von außen ohne Anmeldung auslösbar.
    let token: string;
    try {
      token = decodeURIComponent(m[1]);
    } catch {
      return { ok: false, reason: "path" };
    }
    // Token gegen das tatsächlich erzeugte Format prüfen, bevor irgendetwas
    // die Datenbank sieht.
    if (!isValidStatusToken(token)) return { ok: false, reason: "path" };
    return { ok: true, kind: p.kind, token };
  }
  return { ok: false, reason: "path" };
}

/** Kanonische öffentliche Links — IMMER aus APP_BASE_URL, nie aus der Eingabe. */
export function statusLinksFor(
  kind: StatusLinkKind,
  token: string,
): { statusUrl: string; receiptPdfUrl: string } {
  const base = appBaseUrl();
  const prefix = kind === "feedback" ? "/feedback/status" : "/status";
  return {
    statusUrl: `${base}${prefix}/${token}`,
    receiptPdfUrl: `${base}${prefix}/${token}/pdf`,
  };
}

/** Absolute Download-URL eines öffentlich sichtbaren Anhangs. */
export function attachmentUrlFor(token: string, attachmentId: number): string {
  return `${appBaseUrl()}/api/status/${token}/attachment/${attachmentId}`;
}
