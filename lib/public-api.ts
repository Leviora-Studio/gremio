// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { allowRequestDetailed } from "@/lib/rate-limit";
import { env } from "@/lib/env";

/**
 * Gemeinsame Bausteine der ÖFFENTLICHEN API (`/api/public/v1`) — bewusst
 * getrennt von `lib/api.ts`, das die Bearer-Token-API bedient.
 *
 * Diese Endpunkte sind unauthentifiziert und für direkte native Android-/
 * iOS-Clients gedacht. Native Apps unterliegen keinem Browser-CORS, deshalb
 * werden hier BEWUSST KEINE CORS-Header gesetzt (insbesondere kein
 * `Access-Control-Allow-Origin: *`).
 */

// --- Rate-Limit-Scopes ------------------------------------------------------
// Vollständig getrennt vom Formular-Scope ("submit"): ein Treffer hier lässt das
// Formular unberührt und umgekehrt. Bewusst großzügig, weil native Geräte hinter
// gemeinsam genutzten Carrier-NAT-Adressen erscheinen (viele Nutzer = eine IP).
export const RL_SUBMIT_BURST = {
  scope: "public-api-submit-burst",
  limit: 60,
  windowMs: 60_000,
} as const;
// Backstop gegen Dauerlast. Bewusst ein STUNDEN-Fenster statt 24 h: Ein
// 24-Stunden-Fenster hinterlässt Zähler, die einen ganzen Tag lang nicht
// aufräumbar sind — genau die haben früher den Speicher des Limiters gesättigt.
// Die Schutzwirkung ist gleich (bei 60/min wären 3.600/h möglich, 500 greift
// also früher), das Aufräumen läuft aber wieder auf menschlicher Zeitskala.
export const RL_SUBMIT_DAY = {
  scope: "public-api-submit-day",
  limit: 500,
  windowMs: 60 * 60 * 1000,
} as const;
export const RL_LOCATIONS = {
  scope: "public-api-locations",
  limit: 300,
  windowMs: 60_000,
} as const;

// Feedback hat EIGENE Buckets — ein Ansturm auf die Feedback-API verbraucht
// nichts vom Kontingent der Antrags-API und umgekehrt.
//
// Der Burst liegt bewusst über dem der Anträge und ist identisch zum
// Browserformular (FEEDBACK_FORM_RATE_LIMIT): Feedback ist niedrigschwellig —
// kurz getippt, keine Dateien — und wird typischerweise von vielen Leuten
// gleichzeitig abgegeben, etwa direkt nach einer Sitzung.
export const RL_FEEDBACK_BURST = {
  scope: "public-api-feedback-submit-burst",
  limit: 100,
  windowMs: 60_000,
} as const;
// Stunden-Backstop wie bei den Anträgen (Begründung siehe RL_SUBMIT_DAY).
export const RL_FEEDBACK_DAY = {
  scope: "public-api-feedback-submit-day",
  limit: 500,
  windowMs: 60 * 60 * 1000,
} as const;
export const RL_FEEDBACK_AREAS = {
  scope: "public-api-feedback-areas",
  limit: 300,
  windowMs: 60_000,
} as const;

// Statusabfrage: bewusst großzügig, weil native Apps pollen und viele Geräte
// hinter derselben Carrier-NAT-IP erscheinen. KEIN zusätzliches Tageslimit —
// das träfe sonst ganze Mobilfunk-Zellen. Eigener Bucket, unabhängig von allen
// Einreichungs-Limits.
export const RL_STATUS = {
  scope: "public-api-status",
  limit: 600,
  windowMs: 60_000,
} as const;

export type FieldIssue = { field: string; message: string };

/** Ergebnis von `readLimitedBody`. */
export type LimitedBody =
  | { ok: true; body: ArrayBuffer }
  | { ok: false; reason: "too_large" | "unreadable" };

/**
 * Liest den Request-Body und bricht bei Überschreitung der Grenze WÄHREND des
 * Lesens ab — statt der `Content-Length`-Zusage des Clients zu vertrauen.
 *
 * Nötig, weil der Header bei `Transfer-Encoding: chunked` fehlt und bei HTTP/2
 * regelmäßig nicht gesetzt ist; eine reine Header-Prüfung weist dann nur
 * Clients ab, die ihre Größe selbst ehrlich ankündigen. `bodySizeLimit` aus
 * next.config.mjs gilt ausschließlich für Server Actions, nicht für Route
 * Handler — ohne vorgelagertes nginx (`client_max_body_size`) wäre der Body
 * sonst unbegrenzt.
 */
export async function readLimitedBody(
  req: Request,
  maxBytes: number,
): Promise<LimitedBody> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: true, body: new ArrayBuffer(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  // Als ArrayBuffer zurückgeben: `new Response(...)` akzeptiert ihn direkt.
  return { ok: true, body: out.buffer as ArrayBuffer };
}

/** Einheitliche JSON-Fehlerantwort der öffentlichen API. */
export function publicApiError(
  status: number,
  message: string,
  extra?: { issues?: FieldIssue[]; headers?: Record<string, string> },
): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (extra?.issues?.length) body.issues = extra.issues;
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(extra?.headers ?? {}) },
  });
}

/**
 * Prüft nacheinander mehrere Limits. Jedes hat einen EIGENEN Bucket — ein
 * Treffer des einen ersetzt den anderen nicht. Gibt bei Überschreitung eine
 * fertige 429-Antwort inkl. `Retry-After` zurück.
 */
export async function enforceRateLimits(
  limits: readonly { scope: string; limit: number; windowMs: number }[],
): Promise<NextResponse | null> {
  for (const l of limits) {
    const res = await allowRequestDetailed(l.scope, l.limit, l.windowMs);
    if (!res.allowed) {
      return publicApiError(
        429,
        "Zu viele Anfragen. Bitte später erneut versuchen.",
        { headers: { "Retry-After": String(res.retryAfterSec) } },
      );
    }
  }
  return null;
}

/**
 * Kanonische öffentliche Basis-URL. Ausschließlich aus `APP_BASE_URL` — niemals
 * aus `Host`/`X-Forwarded-Host`, die der Client frei setzen kann (sonst ließe
 * sich der Status-Link auf eine fremde Domain umbiegen).
 */
export function appBaseUrl(): string {
  return env.APP_BASE_URL.replace(/\/+$/, "");
}

/** Öffentliche Links eines Antrags — identisch zu Formular und PDF-Bestätigung. */
export function publicApplicationLinks(token: string): {
  statusUrl: string;
  receiptPdfUrl: string;
} {
  const base = appBaseUrl();
  return {
    statusUrl: `${base}/status/${token}`,
    receiptPdfUrl: `${base}/status/${token}/pdf`,
  };
}

/** Öffentliche Links eines Feedbacks — eigene Routen, nicht die der Anträge. */
export function publicFeedbackLinks(token: string): {
  statusUrl: string;
  receiptPdfUrl: string;
} {
  const base = appBaseUrl();
  return {
    statusUrl: `${base}/feedback/status/${token}`,
    receiptPdfUrl: `${base}/feedback/status/${token}/pdf`,
  };
}
