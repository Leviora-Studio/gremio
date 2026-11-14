// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

const titles: Record<string, string> = {
  created: "Karte erstellt", status: "Status geändert", assignee: "Zuweisung geändert",
  deadline: "Deadline geändert", locked: "Karte dauerhaft gesperrt",
  attachment_added: "Datei hinzugefügt", attachment_removed: "Datei entfernt",
  attachment_folder_created: "Ordner erstellt", attachment_organized: "Datei organisiert",
  archive: "Archivierung abgeschlossen", archive_failed: "Archivierung fehlgeschlagen",
  budget_plan: "Haushaltstitel eingeplant", budget_plan_correction: "Einplanung korrigiert",
};

/** Read historical text snapshots without rewriting stored audit records. */
export function cardActivityDisplay(type: string, visibleDetail: string | null) {
  if (visibleDetail == null) return { title: "Karte aktualisiert", detail: "", planning: null };
  const detail = visibleDetail?.trim() ?? "";
  const title = titles[type] ?? "Karte aktualisiert";
  if (type === "budget_plan" || type === "budget_plan_correction") {
    const afterMarker = "\nNachher:\n", beforeMarker = "\nVorher:\n";
    const afterIndex = detail.lastIndexOf(afterMarker);
    const beforeIndex = detail.lastIndexOf(beforeMarker, afterIndex);
    if (beforeIndex >= 0 && afterIndex > beforeIndex) {
      const prefix = detail.slice(0, beforeIndex);
      const reasonIndex = prefix.indexOf("\nBegründung: ");
      const positions = (value: string) => value.trim() === "Keine Einplanung" ? [] : value.trim().split("\n").filter(Boolean);
      return {
        title, detail: "", planning: {
          reason: reasonIndex >= 0 ? prefix.slice(reasonIndex + "\nBegründung: ".length) : null,
          before: positions(detail.slice(beforeIndex + beforeMarker.length, afterIndex)),
          after: positions(detail.slice(afterIndex + afterMarker.length)),
        },
      };
    }
  }
  return { title, detail: detail === title ? "" : detail, planning: null };
}
