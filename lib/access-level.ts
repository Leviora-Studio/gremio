// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type AccessLevel = "read" | "write";
export const ACCESS_LEVEL_OPTIONS = [
  { value: "read", label: "Lesend" },
  { value: "write", label: "Lesend und schreibend" },
];
/** Missing/invalid input must never accidentally grant write access. */
export function parseAccessLevel(value: unknown): AccessLevel | null {
  return value === "read" || value === "write" ? value : null;
}
