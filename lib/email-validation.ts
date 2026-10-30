// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { z } from "zod";

export const emailAddressSchema = z.string({ required_error: "Bitte eine E-Mail-Adresse angeben.", invalid_type_error: "Bitte eine gültige E-Mail-Adresse angeben." }).refine(value => !/[\r\n]/.test(value), "Ungültige E-Mail-Adresse.").transform(value => value.trim()).pipe(z.string().max(254).email("Bitte eine gültige E-Mail-Adresse angeben."));
export function parseEmailRecipients(raw: string): string[] | null {
  const values = raw.split(/[;,\n]+/).map(value => value.trim()).filter(Boolean);
  if (!values.length || values.length > 50) return null;
  const result = values.map(value => emailAddressSchema.safeParse(value));
  if (result.some(value => !value.success)) return null;
  return [...new Set(result.map(value => value.success ? value.data : ""))];
}
export type EmailPayload = {
  title: string; applicant?: string; receivedAt?: string; statusLink?: string; number?: string | null;
  areaName?: string; feedbackText?: string; boardName?: string; statusName?: string; cardId?: number;
};
