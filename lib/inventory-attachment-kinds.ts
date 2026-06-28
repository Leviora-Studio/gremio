// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

// Reine Konstanten/Typen (ohne DB-/Node-Imports), damit Client-Komponenten sie
// importieren können, ohne den Server-only-Datenzugriff in den Browser zu ziehen.

export const INVENTORY_ATTACHMENT_KINDS = [
  "receipt",
  "loan_request",
  "loan_contract",
  "other",
] as const;
export type InventoryAttachmentKind =
  (typeof INVENTORY_ATTACHMENT_KINDS)[number];

export const INVENTORY_ATTACHMENT_LABELS: Record<
  InventoryAttachmentKind,
  string
> = {
  receipt: "Kaufbelege",
  loan_request: "Leihanträge",
  loan_contract: "Leihverträge",
  other: "Weitere Dateien",
};
