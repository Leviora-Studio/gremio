// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export function deleteConfirmationError(value: unknown): { error: string } | undefined {
  // Match DeleteConfirm's existing case-insensitive UI behavior.
  if (typeof value !== "string" || value.trim().toUpperCase() !== "LÖSCHEN") {
    return { error: "Bitte zum Bestätigen LÖSCHEN eingeben." };
  }
}

type Role = "admin" | "template_manager" | "user";
export function roleConfirmationWord(current: Role, target: Role): string {
  if (target === "admin") return "ADMIN";
  if (current === "admin") return "ENTZIEHEN";
  if (target === "template_manager") return "TEMPLATE";
  return "ENTZIEHEN";
}

export function roleConfirmationError(value: unknown, current: Role, target: Role): { error: string } | undefined {
  const word = roleConfirmationWord(current, target);
  if (typeof value !== "string" || value.trim() !== word) return { error: `Bitte zum Bestätigen ${word} eingeben. Falls die Rolle geändert wurde, lade die Seite neu.` };
}

/** Exact uppercase confirmations for account/profile/visibility changes. */
export function typedConfirmationError(value:unknown,word:string):{error:string}|undefined{
  if(typeof value!=="string"||value.trim()!==word)return {error:`Bitte zum Bestätigen ${word} eingeben.`};
}
