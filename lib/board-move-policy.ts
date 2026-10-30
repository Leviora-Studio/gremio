// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type OfficeMoveRules = { sourceStatusIds: number[]; targetStatusIds: number[] };
export function officeCanMove(rules: OfficeMoveRules | null | undefined, sourceStatusId: number, targetStatusId: number): boolean {
  return !!rules && sourceStatusId !== targetStatusId && rules.sourceStatusIds.includes(sourceStatusId) && rules.targetStatusIds.includes(targetStatusId);
}
