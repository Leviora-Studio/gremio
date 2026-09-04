// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_LABELS,
  addResultSource,
  analyzeResultProtocol,
  initialResultProtocol,
  removeResultSource,
  selectedResultSourceIds,
  structuralResultSourceIds,
} from "../lib/result-protocol";
import { renderResultProtocolFilename } from "../lib/result-protocol-filename";

test("result filenames use the area pattern and cannot collide with the source", () => {
  assert.equal(renderResultProtocolFilename("Ergebnis-{date}-{area}.md", "StuRa", "2026-09-04", "2026-09-04", "Protokoll.md"), "Ergebnis-2026-09-04-StuRa.md");
  assert.equal(renderResultProtocolFilename("{session}-Ergebnis.md", "StuRa", "Sitzung-7", null, "Protokoll.md"), "Sitzung-7-Ergebnis.md");
  assert.throws(() => renderResultProtocolFilename("Ergebnis-{date}.md", "StuRa", "Sitzung", null), /Sitzungsdatum/);
  assert.throws(() => renderResultProtocolFilename("{session}.md", "StuRa", "Protokoll", null, "protokoll.md"), /unterschiedliche Namen/);
});

function automatic(markdown: string) {
  const analysis = analyzeResultProtocol(markdown);
  return analysis.tops.flatMap(top => top.blocks).filter(block => block.automatic);
}

test("all result labels are detected case-insensitively at semantic block starts", () => {
  const variants = RESULT_LABELS.map((label, index) => index % 2 ? `${label.toLocaleUpperCase("de-DE")}: Inhalt` : `${label.toLocaleLowerCase("de-DE")}: Inhalt`);
  const blocks = automatic(`## TOP 1\n\n${variants.join("\n\n")}`);
  assert.deepEqual(blocks.map(block => block.detectedAs), [...RESULT_LABELS]);
  assert.deepEqual(blocks.map(block => block.markdown.trim()), variants);
});

test("bold, heading and list labels preserve their complete Markdown blocks", () => {
  const source = [
    "# Sitzung",
    "",
    "## TOP 1",
    "",
    "**Beschluss:** Text fett",
    "",
    "**Ergebnis**: Text danach",
    "",
    "*Zuständig:* Team A",
    "",
    "- Aufgabe: Protokoll versenden",
    "",
    "### Feststellung",
    "Mehrzeiliger Inhalt",
    "",
    "- Punkt A",
    "- Punkt B",
    "",
    "### Nächster Abschnitt",
    "Diskussion",
  ].join("\n");
  const blocks = automatic(source);
  assert.equal(blocks.length, 5);
  assert.ok(blocks[0].markdown.includes("**Beschluss:** Text fett"));
  assert.ok(blocks[1].markdown.includes("**Ergebnis**: Text danach"));
  assert.equal(blocks[2].markdown.trim(), "*Zuständig:* Team A");
  assert.equal(blocks[3].markdown.trim(), "- Aufgabe: Protokoll versenden");
  assert.ok(blocks[4].markdown.includes("### Feststellung\nMehrzeiliger Inhalt\n\n- Punkt A\n- Punkt B"));
  assert.ok(!blocks[4].markdown.includes("Nächster Abschnitt"));
});

test("standalone labels include the following paragraph, complete list or table", () => {
  const source = [
    "## TOP 1",
    "Beschluss:",
    "",
    "Der Antrag wird angenommen.",
    "",
    "Abstimmung:",
    "",
    "- 12 Ja",
    "- 1 Nein",
    "- 0 Enthaltungen",
    "",
    "Ergebnis:",
    "",
    "| Ja | Nein | Enthaltung |",
    "| --- | --- | --- |",
    "| 12 | 1 | 0 |",
  ].join("\n");
  const blocks = automatic(source);
  assert.equal(blocks.length, 3);
  assert.ok(blocks[0].markdown.endsWith("Der Antrag wird angenommen.\n"));
  assert.ok(blocks[1].markdown.includes("- 12 Ja\n- 1 Nein\n- 0 Enthaltungen"));
  assert.ok(blocks[2].markdown.includes("| 12 | 1 | 0 |"));
});

test("multiple results keep source order and the enclosing TOP", () => {
  const analysis = analyzeResultProtocol("## TOP A\nBeschluss: A\n\nDiskussion\n\nAbstimmung: 2:1\n\n## TOP B\nFrist: Morgen");
  assert.deepEqual(analysis.tops.map(top => top.title), ["TOP A", "TOP B"]);
  assert.deepEqual(analysis.tops[0].blocks.filter(block => block.automatic).map(block => block.detectedAs), ["Beschluss", "Abstimmung"]);
  assert.deepEqual(analysis.tops[1].blocks.filter(block => block.automatic).map(block => block.detectedAs), ["Frist"]);
});

test("frontmatter, fences, sentence occurrences, proposals and empty placeholders are conservative", () => {
  const source = [
    "---", "Beschluss: nicht auswerten", "---",
    "Beschluss: vor TOP manuell möglich", "",
    "## TOP 1", "",
    "```md", "Beschluss: Codebeispiel", "```", "",
    "Über den Beschluss aus der letzten Sitzung wird diskutiert.", "",
    "Mia fragt, wann der Beschluss umgesetzt wird.", "",
    "Es wird ein Beschlussvorschlag vorbereitet.", "",
    "Beschluss:", "",
    "## TOP 2", "Nur Diskussion",
  ].join("\n");
  const analysis = analyzeResultProtocol(source);
  assert.equal(analysis.prelude.some(block => block.detectedAs === "Beschluss"), true);
  assert.equal(analysis.prelude.some(block => block.automatic), false);
  assert.equal(analysis.tops.flatMap(top => top.blocks).some(block => block.automatic), false);
  assert.equal(analysis.tops[1].blocks.some(block => block.automatic), false);
});

test("initial draft uses the first H1, selects only detected TOP results and reports empty TOPs", () => {
  const source = "---\ntitle: intern\n---\n# Sitzung September\n\n## TOP 1\nBeschluss: Ja\n\n## TOP 2\nDiskussion";
  const analysis = analyzeResultProtocol(source);
  const draft = initialResultProtocol(analysis, "2026-09-04");
  assert.ok(draft.startsWith("---\ntitle: intern\n---\n# Ergebnisprotokoll – Sitzung September"));
  assert.doesNotMatch(draft, /^---\n[\s\S]*?\n---\n\n# Ergebnisprotokoll/);
  assert.ok(draft.includes("## TOP 1\n"));
  assert.ok(draft.includes("Beschluss: Ja"));
  assert.ok(!draft.includes("TOP 2"));
  assert.equal(analysis.tops.filter(top => !top.blocks.some(block => block.automatic)).length, 1);
  assert.equal(analysis.frontmatter, "---\ntitle: intern\n---\n");
});

test("initial draft copies the complete technical YAML block without interpreting it", () => {
  const source = "\uFEFF---\r\ncustom: [one, two]\r\nsitzungsleitung: Anna\r\n---\r\n# Sitzung\r\n\r\n## TOP 1\r\nErgebnis: erledigt";
  const draft = initialResultProtocol(analyzeResultProtocol(source), "Sitzung");
  assert.ok(draft.startsWith("\uFEFF---\r\ncustom: [one, two]\r\nsitzungsleitung: Anna\r\n---\r\n# Ergebnisprotokoll"));
});

test("composition deduplicates, preserves manual text and protects edited or detached blocks", () => {
  const source = "## TOP 1\nDiskussion\n\nBeschluss: Ja\n\nAbstimmung: 4:0";
  const analysis = analyzeResultProtocol(source);
  const [discussion, decision, vote] = analysis.tops[0].blocks;
  let draft = initialResultProtocol(analysis, "Ordner");
  const originalSource = source;
  assert.deepEqual([...selectedResultSourceIds(draft)], [decision.id, vote.id]);
  const once = addResultSource(draft, analysis, discussion.id);
  assert.equal(addResultSource(once, analysis, discussion.id), once);
  draft = once.replace("# Ergebnisprotokoll", "Manuelle Einleitung\n\n# Ergebnisprotokoll");
  const removed = removeResultSource(draft, analysis, vote.id);
  assert.equal(removed.status, "removed");
  assert.ok(removed.markdown.includes("Manuelle Einleitung"));
  const edited = removed.markdown.replace("Beschluss: Ja", "Beschluss: Ja, mit Änderung");
  const protectedRemoval = removeResultSource(edited, analysis, decision.id);
  assert.equal(protectedRemoval.status, "modified");
  assert.equal(protectedRemoval.markdown, edited);
  const forced = removeResultSource(edited, analysis, decision.id, true);
  assert.equal(forced.status, "removed");
  const readded = addResultSource(forced.markdown, analysis, decision.id);
  assert.ok(readded.includes("Beschluss: Ja"));
  assert.ok(!readded.includes("Ja, mit Änderung"));
  const detached = edited.replace(/<!-- gremio:result:source:(?:start|end)[^>]*-->\n?/g, "");
  assert.equal(removeResultSource(detached, analysis, decision.id).status, "detached");
  assert.equal(source, originalSource, "source protocol must stay byte-identical");
});

test("folder name is the title fallback when no real H1 exists", () => {
  const draft = initialResultProtocol(analyzeResultProtocol("## TOP 1\nErgebnis: erledigt"), "Sitzung 2026-09-04");
  assert.ok(draft.startsWith("# Ergebnisprotokoll – Sitzung 2026-09-04"));
});

test("prelude sections are inserted before TOPs with their heading structure and compact marker spacing", () => {
  const source = [
    "# Sitzung", "", "## Anwesenheit", "", "### Mitglieder", "",
    "| Mitglied | Anwesend |", "| --- | --- |", "| Anna | Ja |", "",
    "## TOP 1 Bericht", "", "Beschluss: Angenommen", "", "Abstimmung: 4:0",
  ].join("\n");
  const analysis = analyzeResultProtocol(source);
  const table = analysis.prelude.find(block => block.markdown.includes("| Anna | Ja |"))!;
  assert.deepEqual(structuralResultSourceIds(analysis, table.id).map(id => analysis.prelude.find(block => block.id === id)?.markdown.trim()), ["## Anwesenheit", "### Mitglieder", "| Mitglied | Anwesend |\n| --- | --- |\n| Anna | Ja |"]);
  let result = initialResultProtocol(analysis, "Sitzung");
  for (const id of structuralResultSourceIds(analysis, table.id)) result = addResultSource(result, analysis, id);
  assert.ok(result.indexOf("## Anwesenheit") < result.indexOf("### Mitglieder"));
  assert.ok(result.indexOf("### Mitglieder") < result.indexOf("| Anna | Ja |"));
  assert.ok(result.indexOf("| Anna | Ja |") < result.indexOf("## TOP 1 Bericht"));
  assert.doesNotMatch(result, /gremio:result:top:start[^\n]*\n\n## TOP/);
  assert.doesNotMatch(result, /\n{3,}/);
});
