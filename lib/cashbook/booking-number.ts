// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export const defaultBookingNumbering = { prefix: "B", digits: 4 };
export function formatBookingNumber(config: { prefix: string; digits: number }, counter: number): string {
  const digits = Number.isInteger(config.digits) ? Math.max(1, Math.min(12, config.digits)) : 4;
  const number = String(counter).padStart(digits, "0");
  return `${config.prefix.trim()}-${number}`;
}
