// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { createHash } from "node:crypto";
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
/** Binds the refresh token returned by the verified OIDC code exchange to its subject. */
export function refreshIdentity(subject: string, refreshToken: string) {
  return { ssoSubject: subject, refreshTokenHash: createHash("sha256").update(refreshToken).digest("hex") };
}
