// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import sharp from "sharp";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

export function avatarAbsPath(relPath: string): string {
  return join(env.UPLOAD_DIR, relPath);
}

/** Bild quadratisch zuschneiden, auf 256×256 verkleinern, als WebP speichern. */
export async function processAndSaveAvatar(
  userId: number,
  input: Buffer,
): Promise<string> {
  // Pixel-Bombe begrenzen + nur Raster-Formate (kein SVG → XML/SSRF-Vektor).
  const pipeline = sharp(input, { limitInputPixels: 24_000_000 });
  const meta = await pipeline.metadata();
  const allowedFormats = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);
  if (!meta.format || !allowedFormats.has(meta.format)) {
    throw new Error("Nicht unterstütztes Bildformat.");
  }
  const out = await pipeline
    .rotate() // EXIF-Orientierung berücksichtigen
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 82 })
    .toBuffer();

  const rel = join("avatars", `${userId}-${randomUUID()}.webp`);
  const abs = avatarAbsPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, out);
  return rel;
}

export async function deleteAvatarFile(relPath: string): Promise<void> {
  try {
    await unlink(avatarAbsPath(relPath));
  } catch {
    /* schon weg */
  }
}
