// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";
import { McpGrantError } from "@/lib/mcp-oauth";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  authorizeMcp,
  validateAuthorization,
  type AuthorizationRequest,
} from "@/lib/mcp-oauth";
export async function consentAction(
  userId: number,
  expiresAt: number,
  request: AuthorizationRequest,
  _previous: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.id !== userId || Date.now() > expiresAt)
    return { error: "Anmeldung abgelaufen. Bitte erneut verbinden." };
  const auth = await validateAuthorization(request);
  if (!auth)
    return { error: "Ungültige Verbindungsanfrage. Bitte erneut verbinden." };
  if (form.get("decision") === "deny") {
    const url = new URL(request.redirect_uri);
    url.searchParams.set("error", "access_denied");
    if (request.state !== undefined)
      url.searchParams.set("state", request.state);
    redirect(url.toString());
  }
  let destination: string;
  try {
    destination = await authorizeMcp(user, request, {
      scope: form.get("scope"),
      allBoards: form.get("allBoards") === "on",
      boardIds:
        form.get("allBoards") === "on"
          ? []
          : form.getAll("boardId").map(Number),
    });
  } catch (e) {
    return {
      error:
        e instanceof McpGrantError ? e.message : "Freigabe fehlgeschlagen.",
    };
  }
  redirect(destination);
}
