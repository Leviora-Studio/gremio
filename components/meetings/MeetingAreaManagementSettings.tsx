// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { ManagementGrantSettings, type ManagementPerson } from "@/components/ManagementGrantSettings";
import { setMeetingAreaManagerAction } from "@/app/intern/sitzungen/bereich/[id]/einstellungen/management-actions";

export function MeetingAreaManagementSettings({ areaId, candidates, managers }: {
  areaId: number; candidates: ManagementPerson[]; managers: (ManagementPerson & { active: boolean })[];
}) {
  return <ManagementGrantSettings action={setMeetingAreaManagerAction.bind(null, areaId)} candidates={candidates} managers={managers}
    description="Verwaltungsrechte erlauben das Ändern von Allgemein, Tagesordnung, Standard-TOPs, Wordexport, Finanzanträgen und Freigaben sowie Board-Anbindungen einzelner Sitzungen. Rechte auf verknüpften Boards werden weiterhin gesondert geprüft."
    protectedDescription="Löschen, Eigentümerschaft und die Vergabe oder der Entzug von Verwaltungsrechten bleiben Eigentümern und Admins vorbehalten." />;
}
