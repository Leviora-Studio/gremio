// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import { ManagementGrantSettings, type ManagementPerson } from "@/components/ManagementGrantSettings";
import { setBoardManagerAction } from "@/app/intern/board/[id]/einstellungen/management-actions";

export function BoardManagementSettings({ boardId, candidates, managers }: {
  boardId: number; candidates: ManagementPerson[]; managers: (ManagementPerson & { active: boolean })[];
}) {
  return <ManagementGrantSettings action={setBoardManagerAction.bind(null, boardId)} candidates={candidates} managers={managers}
    description="Verwaltungsrechte erlauben das Ändern von Sperrspalten und Zahlungsabschluss, Email-Settings, Freigaben, Spalten, Kartenfeldern, automatischer Antragsnummer, Trigger-Spalten, Standard-Konto und Nextcloud-Archiv." />;
}
