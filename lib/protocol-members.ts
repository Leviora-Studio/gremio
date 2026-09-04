// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { protocolAreas, protocolAttendance, protocolMembers, protocolSessions, type User } from "@/lib/db/schema";
import { canAccessProtocolArea, getProtocolAreaById } from "@/lib/protocols";

export type ProtocolMember = { id: number; name: string; present: boolean; proxyMemberId: number | null };
export type ProtocolMemberCommand =
  | { type: "add"; name: string }
  | { type: "remove"; memberId: number }
  | { type: "reorder"; ids: number[] }
  | { type: "attendance"; memberId: number; present: boolean; proxyMemberId: number | null };
export type ProtocolMemberResult = { members?: ProtocolMember[]; error?: string };

const id = z.number().int().positive();
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), name: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/) }),
  z.object({ type: z.literal("remove"), memberId: id }),
  z.object({ type: z.literal("reorder"), ids: z.array(id).max(500) }),
  z.object({ type: z.literal("attendance"), memberId: id, present: z.boolean(), proxyMemberId: id.nullable() }),
]);

export async function getProtocolMembers(areaId: number, sessionId: number): Promise<ProtocolMember[]> {
  const rows = await db.select({ id: protocolMembers.id, name: protocolMembers.name, present: protocolAttendance.present, proxyMemberId: protocolAttendance.proxyMemberId })
    .from(protocolMembers).leftJoin(protocolAttendance, and(eq(protocolAttendance.memberId, protocolMembers.id), eq(protocolAttendance.sessionId, sessionId)))
    .where(eq(protocolMembers.areaId, areaId)).orderBy(asc(protocolMembers.position), asc(protocolMembers.id));
  return rows.map(row => ({ ...row, present: row.present ?? false }));
}

/** Area lock serializes membership/order edits; no cloud calls inside the transaction. */
export async function changeProtocolMembers(user: User, areaId: number, sessionId: number, input: ProtocolMemberCommand): Promise<ProtocolMember[]> {
  const area = await getProtocolAreaById(areaId);
  if (!area || !(await canAccessProtocolArea(user, area))) throw new Error("Kein Zugriff auf diesen Protokollbereich.");
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new Error("Ungültige Mitgliederdaten. Namen müssen 1–200 Zeichen lang sein.");
  const command = parsed.data;
  await db.transaction(async tx => {
    await tx.select({ id: protocolAreas.id }).from(protocolAreas).where(eq(protocolAreas.id, areaId)).for("update");
    const [session] = await tx.select({ id: protocolSessions.id }).from(protocolSessions)
      .where(and(eq(protocolSessions.id, sessionId), eq(protocolSessions.areaId, areaId))).for("update");
    if (!session) throw new Error("Sitzung gehört nicht zu diesem Protokollbereich.");
    const members = await tx.select().from(protocolMembers).where(eq(protocolMembers.areaId, areaId)).orderBy(asc(protocolMembers.position), asc(protocolMembers.id));
    const ids = new Set(members.map(member => member.id));
    if (command.type === "add") {
      if (members.length >= 500) throw new Error("Pro Protokollbereich sind höchstens 500 Mitglieder möglich.");
      if (members.some(member => member.name.toLocaleLowerCase() === command.name.toLocaleLowerCase())) throw new Error("Dieses Mitglied ist bereits eingetragen.");
      await tx.insert(protocolMembers).values({ areaId, name: command.name, position: (members.at(-1)?.position ?? -1) + 1 });
    } else if (command.type === "reorder") {
      if (command.ids.length !== ids.size || new Set(command.ids).size !== ids.size || command.ids.some(id => !ids.has(id))) throw new Error("Die Mitgliederliste wurde geändert. Bitte neu laden und erneut sortieren.");
      for (const [position, memberId] of command.ids.entries()) await tx.update(protocolMembers).set({ position }).where(and(eq(protocolMembers.id, memberId), eq(protocolMembers.areaId, areaId)));
    } else {
      if (!ids.has(command.memberId)) throw new Error("Mitglied gehört nicht zu diesem Protokollbereich.");
      if (command.type === "remove") {
        await tx.delete(protocolMembers).where(and(eq(protocolMembers.id, command.memberId), eq(protocolMembers.areaId, areaId)));
      } else {
        if (command.proxyMemberId !== null && (!ids.has(command.proxyMemberId) || command.proxyMemberId === command.memberId)) throw new Error("Die Stimme kann nur auf ein anderes Mitglied dieses Bereichs übertragen werden.");
        await tx.insert(protocolAttendance).values({ sessionId, memberId: command.memberId, present: command.present, proxyMemberId: command.proxyMemberId })
          .onConflictDoUpdate({ target: [protocolAttendance.sessionId, protocolAttendance.memberId], set: { present: command.present, proxyMemberId: command.proxyMemberId } });
      }
    }
  });
  return getProtocolMembers(areaId, sessionId);
}
