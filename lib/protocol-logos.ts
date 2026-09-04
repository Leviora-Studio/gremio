// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/lib/db";
import { protocolAreas, protocolLogos, type User } from "@/lib/db/schema";
import { canManageProtocolArea, getProtocolAreaById } from "@/lib/protocols";
import { detectProtocolImageMime } from "@/lib/protocol-image";

export type ProtocolLogo = { id: number; name: string; isDefault: boolean };
export type ProtocolLogoResult = { logos?: ProtocolLogo[]; error?: string };
export const MAX_PROTOCOL_LOGO_BYTES = 5 * 1024 * 1024;

export function getProtocolLogos(areaId: number): Promise<ProtocolLogo[]> {
  return db.select({ id: protocolLogos.id, name: protocolLogos.name, isDefault: protocolLogos.isDefault })
    .from(protocolLogos).where(eq(protocolLogos.areaId, areaId)).orderBy(asc(protocolLogos.id));
}

export async function getProtocolLogoBytes(areaId: number, logoId: number) {
  const [row] = await db.select({ data: protocolLogos.pngBase64 }).from(protocolLogos).where(and(eq(protocolLogos.areaId, areaId), eq(protocolLogos.id, logoId)));
  return row ? Buffer.from(row.data, "base64") : null;
}

export async function normalizeProtocolLogo(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PROTOCOL_LOGO_BYTES || !detectProtocolImageMime(bytes)) throw new Error("Bitte ein PNG-, JPEG-, WebP- oder GIF-Logo bis 5 MB wählen.");
  try {
    // Decode and re-encode: reject disguised SVG/HTML, discard metadata, bound pixel memory.
    const png = await sharp(bytes, { limitInputPixels: 16_000_000, animated: false }).rotate().png().toBuffer();
    if (png.length > MAX_PROTOCOL_LOGO_BYTES) throw new Error();
    return png;
  } catch { throw new Error("Das Logo ist beschädigt oder zu groß (maximal 16 Megapixel und 5 MB)."); }
}

export async function changeProtocolLogo(user: User, areaId: number, command:
  { type: "upload"; file: File } | { type: "default" | "remove"; logoId: number }): Promise<ProtocolLogo[]> {
  const area = await getProtocolAreaById(areaId);
  if (!area || !canManageProtocolArea(user, area)) throw new Error("Keine Berechtigung, Logos für diesen Bereich zu verwalten.");
  let png: Buffer | undefined;
  let name = "";
  if (command.type === "upload") {
    if (!(command.file instanceof File) || command.file.size > MAX_PROTOCOL_LOGO_BYTES) throw new Error("Bitte ein Logo bis 5 MB auswählen.");
    name = command.file.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200).trim();
    if (!name) throw new Error("Das Logo benötigt einen Dateinamen.");
    png = await normalizeProtocolLogo(Buffer.from(await command.file.arrayBuffer()));
  } else if (!["default", "remove"].includes(command.type) || !Number.isSafeInteger(command.logoId) || command.logoId < 1) throw new Error("Ungültiges Logo.");
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(protocolAreas).where(eq(protocolAreas.id, areaId)).for("update");
    if (!locked || !canManageProtocolArea(user, locked)) throw new Error("Die Bereichsrechte wurden geändert.");
    const logos = await tx.select({ id: protocolLogos.id, isDefault: protocolLogos.isDefault }).from(protocolLogos).where(eq(protocolLogos.areaId, areaId)).orderBy(asc(protocolLogos.id));
    if (command.type === "upload") {
      await tx.insert(protocolLogos).values({ areaId, name, pngBase64: png!.toString("base64"), isDefault: logos.length === 0 });
    } else {
      const logo = logos.find(row => row.id === command.logoId);
      if (!logo) throw new Error("Das Logo gehört nicht zu diesem Bereich.");
      if (command.type === "default") {
        await tx.update(protocolLogos).set({ isDefault: false }).where(and(eq(protocolLogos.areaId, areaId), eq(protocolLogos.isDefault, true)));
        await tx.update(protocolLogos).set({ isDefault: true }).where(eq(protocolLogos.id, logo.id));
      } else {
        await tx.delete(protocolLogos).where(eq(protocolLogos.id, logo.id));
        const fallback = logos.find(row => row.id !== logo.id);
        if (logo.isDefault && fallback) await tx.update(protocolLogos).set({ isDefault: true }).where(eq(protocolLogos.id, fallback.id));
      }
    }
  });
  return getProtocolLogos(areaId);
}
