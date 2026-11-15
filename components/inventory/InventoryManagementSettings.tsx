// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { ManagementGrantSettings, type ManagementPerson } from "@/components/ManagementGrantSettings";
import { setInventoryManagerAction } from "@/app/intern/inventar/[id]/einstellungen/management-actions";

export function InventoryManagementSettings({ boardId, candidates, managers }: {
  boardId: number; candidates: ManagementPerson[]; managers: (ManagementPerson & { active: boolean })[];
}) {
  return <ManagementGrantSettings action={setInventoryManagerAction.bind(null, boardId)} candidates={candidates} managers={managers}
    description="Verwaltungsrechte erlauben das Ändern von Email-Settings, Freigaben, Feldern und automatischer Inventarnummer. Die Email-Settings sind verfügbar, sobald ein Leihvorgangsboard eingerichtet ist." />;
}
