// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { z } from "zod";

const schema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET muss mindestens 32 Zeichen lang sein"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) sein"),
  ADMIN_USER: z.string().min(1).default("admin"),
  // --- SSO / OIDC ---
  // Öffentlicher Issuer (Browser nutzt authorize/logout); auch iss-Validierung.
  OIDC_ISSUER: z.string().url(),
  // Server-seitiger Issuer aus dem Container (token/jwks/userinfo); default = OIDC_ISSUER.
  OIDC_INTERNAL_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://postgres:postgres@localhost:5432/gremio"),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "❌ Ungültige Umgebungsvariablen:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    throw new Error("Ungültige Umgebungsvariablen — siehe .env.example");
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
