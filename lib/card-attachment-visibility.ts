// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { AttachmentKind } from "@/lib/constants";

export const CARD_ATTACHMENT_FIELD: Record<AttachmentKind, string> = {
  finance_request: "finance_request",
  annex_a: "annex_a",
  annex_b: "annex_b",
  student_card: "student_card",
  other: "other_pdfs",
};

type CardAttachmentVisibility = {
  kind: string;
  uploadPurpose?: string | null;
};

/**
 * Hidden card fields are a server-side data boundary, not just a UI toggle.
 * Generated instructions remain independently visible because the board's
 * instruction workflow deliberately exposes them even when `other_pdfs` is
 * disabled; all other attachments follow their configured card field.
 */
export function isCardAttachmentVisible(
  attachment: CardAttachmentVisibility,
  visible: ReadonlySet<string>,
): boolean {
  if (
    attachment.kind === "other" &&
    attachment.uploadPurpose === "instruction"
  ) {
    return true;
  }
  const field = CARD_ATTACHMENT_FIELD[attachment.kind as AttachmentKind];
  return !!field && visible.has(field);
}
