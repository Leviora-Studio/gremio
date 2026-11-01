// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { z } from "zod";

/**
 * Übergroße Arrays unabhängig vom internen Zod-Prüfpfad vor der
 * Elementprüfung abweisen; alles andere entscheidet
 * weiterhin `schema` (inklusive seiner eigenen `.max()`-Grenze und Meldung).
 */
export function limitArrayLength<T extends z.ZodTypeAny>(schema: T, max: number) {
  return z.preprocess((value, ctx) => {
    if (Array.isArray(value) && value.length > max) {
      ctx.addIssue({ code: "custom", message: `Höchstens ${max} Einträge erlaubt.`, fatal: true });
      return z.NEVER;
    }
    return value;
  }, schema);
}
