// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { z } from "zod";
import { sanitizeSingleLine, sanitizeMultiLine } from "@/lib/text";

export const meetingStates = { planning: "In Planung", invited: "Eingeladen", held: "Durchgeführt", closed: "Abgeschlossen (Protokoll veröffentlicht)" };
export const topicStates = { proposed: "Vorgeschlagen", scheduled: "Eingeplant", treated: "Behandelt", deferred: "Vertagt", withdrawn: "Zurückgezogen" };
export const topicKinds = { information: "Information", discussion: "Beratung", decision: "Entscheidung" };
const line = (max: number) => z.preprocess(sanitizeSingleLine, z.string().max(max));
const text = z.preprocess(sanitizeMultiLine, z.string().max(10000));
export const meetingInput = z.object({ title: line(200).pipe(z.string().min(1)), areaId: z.coerce.number().int().positive(), location: line(500), chair: line(200), state: z.enum(["planning", "invited", "held", "closed"]), startsAt: z.string(), submissionDeadline: z.string() });
export const agendaSettingsInput = z.object({ publicNumbering: z.enum(["arabic", "roman"]), nonPublicNumbering: z.enum(["arabic", "roman"]), firstSection: z.enum(["public", "non_public"]) });
export const topicInput = z.object({ section: z.enum(["public", "non_public"]).default("public"), parentId: z.preprocess(value => value == null || value === "" ? null : value, z.coerce.number().int().positive().max(2147483647).nullable()).default(null), title: line(200).pipe(z.string().min(1)), description: text, motion: text, presenter: line(200), kind: z.enum(["information", "discussion", "decision"]), durationMinutes: z.coerce.number().int().min(1).max(480), confidential: z.boolean(), state: z.enum(["proposed", "scheduled", "treated", "deferred", "withdrawn"]), outcome: text });
export function berlinInputDate(date: Date | null): string {
  if (!date) return "";
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return p.replace(" ", "T");
}
/** Wall-clock Berlin time, independent of the Node host's timezone; rejects DST gaps. */
export function parseBerlinDate(raw: string): Date | null {
  if (!raw) return null;
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw new Error("Ungültiger Termin.");
  const wall = Date.parse(`${raw}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("Ungültiger Termin.");
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(`${berlinInputDate(new Date(result))}:00Z`);
    result += wall - represented;
  }
  const date = new Date(result);
  if (berlinInputDate(date) !== raw) throw new Error("Dieser Zeitpunkt existiert in Europe/Berlin nicht.");
  return date;
}
