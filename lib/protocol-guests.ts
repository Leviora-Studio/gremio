// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { protocolGuests, protocolSessions, type User } from "@/lib/db/schema";
import { canAccessProtocolArea, getProtocolAreaById } from "@/lib/protocols";

export type ProtocolGuestFields = { name: string; affiliation: string; concern: string };
export type ProtocolGuest = ProtocolGuestFields & { id: number };
export type ProtocolGuestCommand =
  | ({ type: "add" } & ProtocolGuestFields)
  | ({ type: "update"; guestId: number } & ProtocolGuestFields)
  | { type: "remove"; guestId: number };
export type ProtocolGuestResult = { guests?: ProtocolGuest[]; error?: string };

const fields = {
  name: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/),
  affiliation: z.string().trim().max(300).regex(/^[^\x00-\x1f\x7f]*$/),
  concern: z.string().trim().max(1000).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/),
};
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), ...fields }),
  z.object({ type: z.literal("update"), guestId: z.number().int().positive(), ...fields }),
  z.object({ type: z.literal("remove"), guestId: z.number().int().positive() }),
]);

export async function getProtocolGuests(areaId: number, sessionId: number): Promise<ProtocolGuest[]> {
  return db.select({ id: protocolGuests.id, name: protocolGuests.name, affiliation: protocolGuests.affiliation, concern: protocolGuests.concern })
    .from(protocolGuests).innerJoin(protocolSessions, eq(protocolSessions.id, protocolGuests.sessionId))
    .where(and(eq(protocolSessions.areaId, areaId), eq(protocolGuests.sessionId, sessionId))).orderBy(asc(protocolGuests.id));
}

export async function changeProtocolGuests(user: User, areaId: number, sessionId: number, input: ProtocolGuestCommand): Promise<ProtocolGuest[]> {
  const area = await getProtocolAreaById(areaId);
  if (!area || !(await canAccessProtocolArea(user, area))) throw new Error("Kein Zugriff auf diesen Protokollbereich.");
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new Error("Bitte einen Namen (max. 200 Zeichen), eine Zugehörigkeit (max. 300) und ein Anliegen (max. 1000) ohne ungültige Steuerzeichen eingeben.");
  const command = parsed.data;
  await db.transaction(async tx => {
    const [session] = await tx.select({ id: protocolSessions.id }).from(protocolSessions)
      .where(and(eq(protocolSessions.id, sessionId), eq(protocolSessions.areaId, areaId))).for("update");
    if (!session) throw new Error("Sitzung gehört nicht zu diesem Protokollbereich.");
    if (command.type === "add") {
      const guests = await tx.select({ id: protocolGuests.id }).from(protocolGuests).where(eq(protocolGuests.sessionId, sessionId));
      if (guests.length >= 500) throw new Error("Pro Sitzung sind höchstens 500 Gäste möglich.");
      await tx.insert(protocolGuests).values({ sessionId, name: command.name, affiliation: command.affiliation, concern: command.concern });
    } else {
      const target = and(eq(protocolGuests.id, command.guestId), eq(protocolGuests.sessionId, sessionId));
      const changed = command.type === "remove"
        ? await tx.delete(protocolGuests).where(target).returning({ id: protocolGuests.id })
        : await tx.update(protocolGuests).set({ name: command.name, affiliation: command.affiliation, concern: command.concern }).where(target).returning({ id: protocolGuests.id });
      if (!changed.length) throw new Error("Gast nicht in dieser Sitzung gefunden. Bitte neu laden.");
    }
  });
  return getProtocolGuests(areaId, sessionId);
}
