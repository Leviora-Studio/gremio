// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import React from "react";
import { createRoot } from "react-dom/client";
import { ResultProtocolEditor } from "../../components/documents/ResultProtocolEditor";
import { analyzeResultProtocol, initialResultProtocol } from "../../lib/result-protocol";

const baseSource = [
  "---", "intern: true", "---", "# Sitzung September", "",
  "## TOP 1 Bericht", "Diskussion zum Antrag.", "", "Beschluss: Der Antrag wird angenommen.", "", "Abstimmung: 4 Ja, 0 Nein", "",
  "## TOP 2 Verschiedenes", "Allgemeine Aussprache ohne Beschluss.",
].join("\n");
const scrollSource = ["# Lange Sitzung", ...Array.from({ length: 18 }, (_, index) => [
  "", `## TOP ${index + 1} Testpunkt`, "", `Beschluss: Entscheidung ${index + 1} mit einer längeren Beschreibung für die synchrone Darstellung.`, "", `Abstimmung: ${index + 3} Ja, 0 Nein`,
]).flat()].join("\n");
const attendanceSource = [
  "# Sitzung September", "", "## Anwesenheit", "", "### Mitglieder", "",
  "| Mitglied | Anwesend |", "| --- | --- |", "| Anna | Ja |", "",
  "## TOP 1 Bericht", "", "Beschluss: Der Antrag wird angenommen.",
].join("\n");
const source = location.search.includes("scroll") ? scrollSource : location.search.includes("attendance") ? attendanceSource : baseSource;
const generated = initialResultProtocol(analyzeResultProtocol(source), "2026-09-04");
const existing = "# Vorhandenes Ergebnis\n\nManuell in Nextcloud gepflegter Inhalt.\n";
const saved: { expected: string | null | undefined; content: string }[] = [];
Object.assign(window, { saved, source });
const persisted = location.search.includes("existing");
createRoot(document.getElementById("root")!).render(<ResultProtocolEditor
  sourceContent={source}
  initialResult={persisted ? existing : generated}
  initialFileId={persisted ? "result-1" : null}
  initiallyPersisted={persisted}
  filename="Ergebnisprotokoll.md"
  folderName="2026-09-04"
  backHref="#protocol"
  saveAction={async (expected, content) => { saved.push({ expected, content }); return { savedToNextcloud: true, content, fileId: "result-1", success: "Gespeichert" }; }}
  reloadAction={async () => ({ content: existing, fileId: "result-1" })}
  areaId={2}
  logos={[]}
  exportAction={async () => ({ success: "PDF gespeichert" })}
/>);
