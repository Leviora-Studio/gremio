// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export const HOME_SECTIONS = [
  { key: "tasks", label: "Meine Aufgaben" },
  { key: "boards", label: "Boards" },
  { key: "protocols", label: "Protokollbereiche" },
  { key: "finances", label: "Finanzübersichten" },
  { key: "inventories", label: "Inventare" },
] as const;

export type HomeSectionKey = typeof HOME_SECTIONS[number]["key"];
export type HomePref = Record<HomeSectionKey, boolean> & { order: HomeSectionKey[] };

const keys = HOME_SECTIONS.map(section => section.key);

/** Fill old or malformed JSON preferences without hiding newly introduced sections. */
export function normalizeHomePref(input: unknown): HomePref {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const requested = Array.isArray(source.order) ? source.order : [];
  const order = requested.filter((key, index): key is HomeSectionKey => typeof key === "string" && keys.includes(key as HomeSectionKey) && requested.indexOf(key) === index);
  for (const key of keys) if (!order.includes(key)) order.push(key);
  return {
    tasks: source.tasks !== false,
    boards: source.boards !== false,
    protocols: source.protocols !== false,
    finances: source.finances !== false,
    inventories: source.inventories !== false,
    order,
  };
}
