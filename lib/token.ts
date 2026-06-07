// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { customAlphabet } from "nanoid";
import { TOKEN_ALPHABET, TOKEN_LENGTH } from "@/lib/constants";

const nano = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);

/** 30-stelliger, zufälliger Status-Token. */
export function generateToken(): string {
  return nano();
}

/**
 * True, wenn der Fehler eine Unique-Violation auf cards.token ist
 * (Postgres-Code 23505 + Constraint-Name enthält „token"). Dann lohnt ein
 * erneuter Versuch mit frischem Token.
 */
export function isTokenConflict(e: unknown): boolean {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = err.code ?? err.cause?.code;
  const constraint = err.constraint ?? err.cause?.constraint ?? "";
  return code === "23505" && constraint.includes("token");
}
