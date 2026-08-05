// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { createHmac, timingSafeEqual } from "node:crypto";
import { clientIpHmac } from "@/lib/client-ip";
import { deriveKey } from "@/lib/crypto";

// Spam-Schutz fürs öffentliche Formular: Honeypot + signierte Zeitfalle.
// Beides unsichtbar für echte Nutzer, ohne Drittanbieter, ohne IP-Speicherung.

const MIN_FILL_MS = 3000; // < 3 s ausgefüllt → mit hoher Sicherheit ein Bot
/**
 * Gültigkeit des Zeitfallen-Tokens: 6 Stunden.
 *
 * Vorher 24 h. Ein einmal geholtes Token ließ sich damit einen ganzen Tag lang
 * beliebig oft wiederverwenden — für eine Massen-Einsendung genügte ein
 * einziger Formularaufruf. Sechs Stunden decken jedes realistische
 * Ausfüllverhalten ab (auch „Tab bleibt über die Mittagspause offen") und
 * verkürzen das Wiederverwendungsfenster deutlich.
 */
const MAX_FILL_MS = 6 * 60 * 60 * 1000;

// Zweckgebundene HMAC-Schlüssel (nicht das rohe AUTH_SECRET).
const TIMING_HMAC_KEY = deriveKey("antispam-timing");
const TIMING_IP_KEY = deriveKey("antispam-timing-ip");

/**
 * Signiert Zeitstempel UND Client-Kennung. Die Bindung an den Client ist der
 * eigentliche Punkt: Ohne sie taugte ein einziges, irgendwo abgeholtes Token
 * für Einsendungen aus beliebig vielen Quellen — die Zeitfalle prüfte dann nur
 * noch, dass das Token echt und nicht zu alt war, nicht mehr, dass derselbe
 * Client das Formular überhaupt geöffnet hatte.
 */
function sign(ts: string, client: string): string {
  return createHmac("sha256", TIMING_HMAC_KEY)
    .update(`${ts}:${client}`)
    .digest("hex");
}

/** Erzeugt das Zeitfallen-Token (Zeitstempel + HMAC-Signatur) fürs Formular. */
export async function makeFormGuard(): Promise<{ ts: string; sig: string }> {
  const ts = String(Date.now());
  return { ts, sig: sign(ts, await clientIpHmac(TIMING_IP_KEY)) };
}

/** Honeypot-Feld befüllt? (Menschen lassen es leer.) */
export function isHoneypotFilled(value: FormDataEntryValue | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Ergebnis der Zeitfallen-Prüfung. Die drei Fälle werden BEWUSST unterschieden,
 * weil sie unterschiedlich behandelt gehören:
 *
 *  - `ok`       — plausibel ein Mensch, Einreichung läuft normal weiter.
 *  - `too_fast` — unter der Mindestzeit ausgefüllt: praktisch immer ein Bot.
 *                 Aufrufer täuschen hier eine Bestätigung vor, ohne etwas
 *                 anzulegen — der Bot soll nicht lernen, woran er scheitert.
 *  - `invalid`  — Signatur fehlt/gefälscht, gehört zu einem anderen Client oder
 *                 ist abgelaufen. Das trifft AUCH echte Nutzer: ein zu lange
 *                 offener Tab, ein Netzwechsel (andere IP), ein Neustart der
 *                 App mit neuem AUTH_SECRET. Die stille Fake-Bestätigung war
 *                 hier die falsche Antwort — sie warf den mühsam getippten
 *                 Freitext weg und behauptete dabei, alles sei angekommen.
 *                 Aufrufer müssen daraus eine sichtbare Meldung machen und das
 *                 Formular mit den Eingaben erneut anzeigen.
 */
export type TimingVerdict = "ok" | "too_fast" | "invalid";

/**
 * Prüft die Zeitfalle: gültige (nicht gefälschte, an DIESEN Client gebundene)
 * Signatur und realistische Ausfüllzeit.
 */
export async function checkFormTiming(
  tsRaw: FormDataEntryValue | null,
  sigRaw: FormDataEntryValue | null,
): Promise<TimingVerdict> {
  const ts = typeof tsRaw === "string" ? tsRaw : "";
  const sig = typeof sigRaw === "string" ? sigRaw : "";
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(sig)) return "invalid";

  const expected = sign(ts, await clientIpHmac(TIMING_IP_KEY));
  if (sig.length !== expected.length) return "invalid";
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }

  const age = Date.now() - Number(ts);
  // Zeitstempel aus der Zukunft (verstellte Uhr, manipuliertes Feld) zählen wie
  // „zu schnell" — sie sind nie ein legitimer Ausfüllvorgang.
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_FILL_MS) return "invalid";
  return "ok";
}

/**
 * Meldung für den `invalid`-Fall — identisch in beiden öffentlichen Formularen.
 * Sagt dem Nutzer, was zu tun ist, ohne den Schutzmechanismus zu erklären.
 */
export const FORM_GUARD_EXPIRED_MESSAGE =
  "Das Formular war zu lange geöffnet oder die Verbindung hat sich geändert. Deine Eingaben sind erhalten — bitte sende sie einfach erneut ab.";
