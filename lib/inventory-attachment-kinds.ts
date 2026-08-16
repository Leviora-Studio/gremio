// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

// Reine Konstanten/Typen (ohne DB-/Node-Imports), damit Client-Komponenten sie
// importieren können, ohne den Server-only-Datenzugriff in den Browser zu ziehen.

export const INVENTORY_ATTACHMENT_KINDS = [
  "receipt",
  "loan_request",
  "loan_contract",
  "student_card",
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
  student_card: "Studierendenausweis",
  other: "Weitere Dateien",
};

/**
 * Arten, die über den öffentlichen Status-Token abrufbar sind. Bewusst als
 * Whitelist: Ein neu ergänzter kind ist damit standardmäßig NICHT öffentlich.
 * `student_card` (Ausweisdokument) darf hier niemals auftauchen.
 */
export const PUBLIC_LOAN_ATTACHMENT_KINDS: readonly InventoryAttachmentKind[] = [
  "loan_request",
  "loan_contract",
];

/** Erlaubte MIME-Typen für den Studierendenausweis (PDF, PNG, JPG/JPEG). */
export const STUDENT_CARD_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

/** `accept`-Wert des Datei-Inputs für den Studierendenausweis. */
export const STUDENT_CARD_ACCEPT =
  "application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg";
