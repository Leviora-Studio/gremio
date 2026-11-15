// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { Board } from "@/lib/db/schema";
import type { TriggerKind } from "@/lib/constants";

type TriggerBoard = Pick<Board, "isApplicationBoard" | "inventoryBoardId">;

/** Legacy configuration may remain stored, but must never reactivate retired triggers. */
export function isBoardTriggerAvailable(board: TriggerBoard, kind: TriggerKind): boolean {
  if (board.inventoryBoardId != null || kind === "instruction" || kind === "transfer") return false;
  return kind !== "done" || !board.isApplicationBoard;
}

export function effectiveDoneStatusId(board: TriggerBoard & Pick<Board, "doneStatusId">): number | null {
  return isBoardTriggerAvailable(board, "done") ? board.doneStatusId : null;
}

export function isArchiveTriggerEnabled(board: TriggerBoard, status: { isArchiveTrigger: boolean | null } | null | undefined): boolean {
  return isBoardTriggerAvailable(board, "archive") && !!status?.isArchiveTrigger;
}
