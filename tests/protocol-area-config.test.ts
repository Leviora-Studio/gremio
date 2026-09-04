// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { availableProtocolFinanceFields, orderedProtocolFinanceFields, parseProtocolAreaContent, protocolTemplateSource } from "../lib/protocol-area-config";
import { extractFinanceLinks, formatFinanceBlock, renderProtocolTemplate } from "../lib/protocol-markdown";

test("new field selections are unchecked; saved order survives board visibility changes", () => {
  const available = availableProtocolFinanceFields(["notes", "applicant", "unknown", "notes"]);
  assert.deepEqual(available, ["notes", "applicant", "created_at", "updated_at"]);
  assert.ok(orderedProtocolFinanceFields([], available).every(field => !field.enabled));
  assert.deepEqual(orderedProtocolFinanceFields([{ key: "applicant", enabled: true }, { key: "budget_title", enabled: true }, { key: "notes", enabled: false }], available), [
    { key: "applicant", enabled: true }, { key: "notes", enabled: false }, { key: "created_at", enabled: false }, { key: "updated_at", enabled: false },
  ]);
});

test("settings preserve literal Markdown, validate only active custom protocol variables", () => {
  const data = new FormData(); data.set("templateId", "custom");
  const custom = "  # Sitzung {{session.date_de}}\n\n**Text**  \n";
  const decision = "\n  **Beschluss:** {{literal}}  \n\n- Ja\n- Nein\n";
  data.set("customTemplateMarkdown", custom); data.set("decisionTemplateMarkdown", decision); data.set("decisionTemplateEnabled", "on");
  const result = parseProtocolAreaContent(data);
  assert.equal(result.customTemplateMarkdown, custom); assert.equal(result.decisionTemplateMarkdown, decision);
  assert.equal(result.templateId, null); assert.equal(result.decisionTemplateEnabled, true); assert.deepEqual(result.financeFields, []);
  data.set("customTemplateMarkdown", "{{unknown}}"); assert.throws(() => parseProtocolAreaContent(data), /Unbekannte/);
  data.set("templateId", "1"); assert.equal(parseProtocolAreaContent(data).customTemplateMarkdown, "{{unknown}}");
  data.delete("decisionTemplateEnabled"); assert.equal(parseProtocolAreaContent(data).decisionTemplateEnabled, false);
  for (const value of ["", "0", "-1", "1.5", "NaN"]) { data.set("templateId", value); assert.throws(() => parseProtocolAreaContent(data), /vorlage/i); }
  data.set("templateId", "1");
  for (const fields of ["{", "{}", '[{"key":"token","enabled":true}]', '[{"key":"notes","enabled":"yes"}]', '[{"key":"notes","enabled":true},{"key":"notes","enabled":false}]']) {
    data.set("financeFields", fields); assert.throws(() => parseProtocolAreaContent(data), /Kartenfeld/);
  }
  data.set("financeFields", "[]"); data.set("decisionTemplateMarkdown", "x".repeat(50_001)); assert.throws(() => parseProtocolAreaContent(data), /lang/);
});

test("own templates are area-local, empty is allowed, system templates use their loader", async () => {
  const load = async (id: number) => { assert.equal(id, 4); return { markdown: "System" }; };
  assert.equal(await protocolTemplateSource({ templateId: 4, customTemplateMarkdown: "Draft" }, load), "System");
  assert.equal(await protocolTemplateSource({ templateId: null, customTemplateMarkdown: "Area A" }, load), "Area A");
  assert.equal(await protocolTemplateSource({ templateId: null, customTemplateMarkdown: "Area B" }, load), "Area B");
  assert.equal(await protocolTemplateSource({ templateId: null, customTemplateMarkdown: "" }, load), "");
  assert.equal(renderProtocolTemplate("# {{session.date_de}}", { "session.date_de": "04.09.2026", "session.date": "2026-09-04", "session.folder_name": "Test", "protocol_area.name": "Area", created_at: "now" }), "# 04.09.2026");
});

test("finance blocks only include chosen fields in order, followed by byte-identical decision template", () => {
  const card = { id: 42, title: "Antrag", number: "SECRET NUMBER", applicant: "SECRET NAME", amount: 12500, fields: [{ key: "budget_title", label: "Haushaltstitel", value: "0201" }, { key: "requested_amount", label: "Beantragter Betrag", value: "125,00 €" }] };
  const template = "  **Beschluss**  \n\n| Ja | Nein |\n| --- | --- |\n|  |  |\n\n{{unexpanded}}\n";
  const block = formatFinanceBlock(card, "5.1", "https://example.invalid/intern/card/42", template);
  assert.ok(block.indexOf("Haushaltstitel") < block.indexOf("Beantragter Betrag"));
  assert.ok(block.endsWith("(https://example.invalid/intern/card/42)\n" + template + "\n\n<!-- gremio:finance:end card=42 -->"));
  assert.ok(!block.includes("SECRET")); assert.deepEqual(extractFinanceLinks(block), [{ cardId: 42, top: "5.1" }]);
  const plain = formatFinanceBlock({ ...card, fields: [] }, "5.1", "https://example.invalid/intern/card/42", "");
  assert.ok(!plain.includes("Haushaltstitel")); assert.ok(!plain.includes("Beschluss"));
  assert.equal(formatFinanceBlock(card, "5.1", "url"), formatFinanceBlock(card, "5.1", "url", ""));
  assert.ok(formatFinanceBlock(card, "5.1", "url", "**Beschluss**").includes("[Finanzantrag in Gremio öffnen](url)\n**Beschluss**"));
});
