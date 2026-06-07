// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/lib/crypto";

// Spam-Schutz fürs öffentliche Formular: Honeypot + signierte Zeitfalle.
// Beides unsichtbar für echte Nutzer, ohne Drittanbieter, ohne IP-Speicherung.

const MIN_FILL_MS = 3000; // < 3 s ausgefüllt → mit hoher Sicherheit ein Bot
const MAX_FILL_MS = 24 * 60 * 60 * 1000; // 24 h offen → Token gilt nicht mehr

// Zweckgebundener HMAC-Schlüssel (nicht das rohe AUTH_SECRET).
const TIMING_HMAC_KEY = deriveKey("antispam-timing");

function sign(ts: string): string {
  return createHmac("sha256", TIMING_HMAC_KEY).update(ts).digest("hex");
}

/** Erzeugt das Zeitfallen-Token (Zeitstempel + HMAC-Signatur) fürs Formular. */
export function makeFormGuard(): { ts: string; sig: string } {
  const ts = String(Date.now());
  return { ts, sig: sign(ts) };
}

/** Honeypot-Feld befüllt? (Menschen lassen es leer.) */
export function isHoneypotFilled(value: FormDataEntryValue | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Prüft die Zeitfalle: gültige (nicht gefälschte) Signatur UND realistische
 * Ausfüllzeit. Gibt true zurück, wenn es plausibel ein Mensch war.
 */
export function isHumanTiming(
  tsRaw: FormDataEntryValue | null,
  sigRaw: FormDataEntryValue | null,
): boolean {
  const ts = typeof tsRaw === "string" ? tsRaw : "";
  const sig = typeof sigRaw === "string" ? sigRaw : "";
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(sig)) return false;

  const expected = sign(ts);
  if (sig.length !== expected.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return false;
    }
  } catch {
    return false;
  }

  const age = Date.now() - Number(ts);
  return age >= MIN_FILL_MS && age <= MAX_FILL_MS;
}
