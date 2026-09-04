// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { CARD_FIELD_KEYS, CARD_FIELD_LABELS } from "./constants";
import { validateProtocolTemplate } from "./protocol-markdown";

export type ProtocolFinanceField = { key: string; enabled: boolean };
export const PROTOCOL_FINANCE_LABELS: Record<string, string> = {
  ...CARD_FIELD_LABELS, created_at: "Erstellt am", updated_at: "Letzte Änderung",
};
export function availableProtocolFinanceFields(visibleKeys: string[]): string[] {
  return [...new Set(visibleKeys.filter(key => (CARD_FIELD_KEYS as readonly string[]).includes(key))), "created_at", "updated_at"];
}
export function orderedProtocolFinanceFields(saved: ProtocolFinanceField[], available: string[]): ProtocolFinanceField[] {
  const allowed = new Set(available);
  const seen = new Set<string>();
  return [...saved, ...available.map(key => ({ key, enabled: false }))].filter(field => {
    if (!allowed.has(field.key) || seen.has(field.key)) return false;
    seen.add(field.key); return true;
  });
}

/** Preserve the literal Markdown, including leading/trailing whitespace. */
export function parseProtocolAreaContent(formData: FormData) {
  const template = String(formData.get("templateId") ?? "");
  const templateId = template === "custom" ? null : Number(template);
  if (templateId !== null && (!Number.isSafeInteger(templateId) || templateId <= 0)) throw new Error("Bitte eine Protokollvorlage wählen.");
  const customTemplateMarkdown = String(formData.get("customTemplateMarkdown") ?? "");
  const decisionTemplateMarkdown = String(formData.get("decisionTemplateMarkdown") ?? "");
  if (customTemplateMarkdown.length > 200_000 || decisionTemplateMarkdown.length > 50_000) throw new Error("Die Vorlage ist zu lang (Protokoll: 200.000, Beschluss: 50.000 Zeichen).");
  if (templateId === null) validateProtocolTemplate(customTemplateMarkdown);
  let fields: unknown;
  try { fields = JSON.parse(String(formData.get("financeFields") ?? "[]")); }
  catch { throw new Error("Ungültige Kartenfeldauswahl."); }
  if (!Array.isArray(fields) || fields.length > Object.keys(PROTOCOL_FINANCE_LABELS).length || fields.some(field => !field || typeof field.key !== "string" || !Object.hasOwn(PROTOCOL_FINANCE_LABELS, field.key) || typeof field.enabled !== "boolean") || new Set(fields.map(field => field.key)).size !== fields.length) throw new Error("Ungültige Kartenfeldauswahl.");
  return { templateId, customTemplateMarkdown, financeFields: fields as ProtocolFinanceField[], decisionTemplateEnabled: formData.get("decisionTemplateEnabled") === "on", decisionTemplateMarkdown };
}

export async function protocolTemplateSource(area: { templateId: number | null; customTemplateMarkdown: string }, load: (id: number) => Promise<{ markdown: string }>): Promise<string> {
  return area.templateId === null ? area.customTemplateMarkdown : (await load(area.templateId)).markdown;
}
