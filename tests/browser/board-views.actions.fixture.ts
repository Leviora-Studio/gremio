// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export async function moveCardAction(cardId: number, statusId: number, orderedIds: number[]) {
  window.dispatchEvent(new CustomEvent("fixture-move", { detail: { cardId, statusId, orderedIds } }));
}
