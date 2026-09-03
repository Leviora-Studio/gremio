// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFinanceLinks,
  formatFinanceBlock,
  mayReplaceDecisionRef,
  renderDecisionRef,
  renderProtocolTemplate,
  renderSessionName,
  upsertToc,
  validateFilePattern,
  validateProtocolTemplate,
} from "../lib/protocol-markdown";

test("Sitzungs- und Dateimuster lösen nur dokumentierte Platzhalter auf", () => {
  const folder = renderSessionName("{YYYY}-{MM}-{DD}-{area}", "2026-08-14", "Großer StuRa");
  assert.equal(folder, "2026-08-14-Großer StuRa");
  assert.equal(validateFilePattern("{session}-Protokoll.md", "2026-08-14", "Großer StuRa", folder), "2026-08-14-Großer StuRa-Protokoll.md");
  assert.throws(() => renderSessionName("../{date}", "2026-08-14", "Gremium"), /Pfadtrenner/);
  assert.throws(() => validateFilePattern("Protokoll.txt", "2026-08-14", "Gremium", folder), /\.md/);
  assert.throws(() => renderSessionName("{unknown}", "2026-08-14", "Gremium"), /Unbekannter Platzhalter/);
  assert.throws(() => renderSessionName("{date}", "2026-02-31", "Gremium"), /ungültig/);
});

test("Protokollvorlagen erhalten unbekannte Variablen nicht stillschweigend", () => {
  validateProtocolTemplate("# {{session.date_de}} — {{protocol_area.name}}");
  assert.throws(() => validateProtocolTemplate("{{session.secret}}"), /Unbekannte Vorlagenvariable/);
  assert.equal(
    renderProtocolTemplate("# {{session.folder_name}}", {
      "session.date": "2026-08-14",
      "session.date_de": "14.08.2026",
      "session.folder_name": "2026-08-14",
      "protocol_area.name": "Gremium",
      created_at: "2026-08-14T10:00:00.000Z",
    }),
    "# 2026-08-14",
  );
});

test("verwaltetes Inhaltsverzeichnis wird aktualisiert statt verdoppelt", () => {
  const markdown = "# Sitzung\n\n## Ämter & Übergabe\n\n### Details\n\n## Ämter & Übergabe\n";
  const once = upsertToc(markdown);
  const twice = upsertToc(once.replace("### Details", "### Neue Details"));
  assert.equal((twice.match(/gremio:toc:start/g) ?? []).length, 1);
  assert.match(twice, /#ämter-übergabe/);
  assert.match(twice, /#ämter-übergabe-1/);
  assert.match(twice, /#neue-details/);
  assert.doesNotMatch(twice, /#details\)/);
});

test("Finanzblöcke tragen eine stabile Karten-ID und eine TOP-Nummer", () => {
  const block = formatFinanceBlock(
    { id: 42, number: "2026_GSR_014", title: "Sommerfest", applicant: "Fachschaft", amount: 85000 },
    "5.1",
    "https://gremio.example/intern/card/42",
  );
  assert.deepEqual(extractFinanceLinks(block), [{ cardId: 42, top: "5.1" }]);
  assert.match(block, /850,00\s€/);
  assert.match(block, /\/intern\/card\/42/);
  assert.deepEqual(
    extractFinanceLinks(block.replace(/<!-- gremio:finance:[^>]+-->\n?/g, "")),
    [{ cardId: 42, top: "5.1" }],
    "der normale HTTPS-Kartenlink ist auch ohne HTML-Kommentare stabil",
  );
});

test("Beschlussreferenz wird aus Sitzung und TOP erzeugt", () => {
  assert.equal(renderDecisionRef("{YYYY}-{MM}-{DD}-{session}-TOP-{top}", "S-14", "2026-08-14", "5.1"), "2026-08-14-S-14-TOP-5.1");
  assert.throws(
    () => renderDecisionRef("{session}-{unknown}", "S-14", "2026-08-14", "5.1"),
    /Unbekannter Platzhalter/,
  );
  assert.equal(mayReplaceDecisionRef(null, []), true);
  assert.equal(mayReplaceDecisionRef("2026-08-14-TOP-5.1", ["2026-08-14-TOP-5.1"]), true);
  assert.equal(mayReplaceDecisionRef("Manueller Beschluss 7/26", ["2026-08-14-TOP-5.1"]), false);
});
