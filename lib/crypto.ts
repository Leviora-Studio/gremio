// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/env";

function key(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex"); // 32 Byte (AES-256)
}

/**
 * Zweckgebundener 32-Byte-Unterschlüssel aus AUTH_SECRET (HKDF-SHA256, je Zweck
 * eigenes `info`-Label) → Domänentrennung: eine Nutzung (z. B. Rate-Limit-IP-
 * HMAC, Anti-Spam-Zeitfalle) kann die anderen nicht schwächen, und keine teilt
 * den Schlüssel direkt mit der iron-session-Versiegelung.
 */
export function deriveKey(purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", env.AUTH_SECRET, "gremio-key-derivation", purpose, 32),
  );
}

/** AES-256-GCM verschlüsseln → "iv:tag:ciphertext" (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = (payload ?? "").split(":");
  // parts[2] (Ciphertext) darf LEER sein: AES-GCM eines leeren Klartexts ergibt
  // leeren Ciphertext mit gültigem Tag — z. B. eine .p12 OHNE Passphrase. Nur
  // IV und Tag müssen vorhanden sein, sonst stimmt Format/Schlüssel nicht.
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    throw new Error(
      "Ungültiger verschlüsselter Wert (Format/Schlüssel passt nicht).",
    );
  }
  const [ivB, tagB, dataB] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
