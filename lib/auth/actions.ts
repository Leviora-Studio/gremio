// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "./session";
import { buildEndSessionUrl, revokeToken } from "@/lib/oidc";

/** Lokale Session beenden und beim SSO abmelden (RP-initiated logout). */
export async function logoutAction(): Promise<void> {
  const session = await getSession();
  const idToken = session.idToken;
  const accessToken = session.accessToken;
  const refreshToken = session.refreshToken;
  session.destroy();

  // Tokens am SSO widerrufen (RFC 7009) — best effort, blockiert Logout nicht.
  await revokeToken(refreshToken, "refresh_token");
  await revokeToken(accessToken, "access_token");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const postLogout = `${proto}://${host}/`;

  redirect(await buildEndSessionUrl(idToken, postLogout));
}
