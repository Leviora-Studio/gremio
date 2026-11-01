// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export const wordStyleRoles = {
  title: "Dokumenttitel",
  body: "Fließtext und TOP-Inhalt",
  section: "Überschrift öffentlicher / nicht öffentlicher Teil",
  publicTopic: "Öffentlicher TOP 1. Ordnung",
  publicSubtopic: "Öffentlicher TOP 2. Ordnung",
  nonPublicTopic: "Nicht öffentlicher TOP 1. Ordnung",
  nonPublicSubtopic: "Nicht öffentlicher TOP 2. Ordnung",
};
export type WordStyleRole = keyof typeof wordStyleRoles;
export type WordStyleMapping = Record<WordStyleRole, string>;
export type MeetingWordConfiguration = {
  styles: WordStyleMapping;
  insertion: "replace" | "placeholder" | "append";
  start: number;
  end: number;
};
export type WordTemplateInfo = {
  styles: {id:string;name:string}[];
  blocks: {index:number;label:string}[];
  hasPlaceholder: boolean;
  configuration: MeetingWordConfiguration;
};
