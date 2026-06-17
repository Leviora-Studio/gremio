// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import sharp from "sharp";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

export function signatureAbsPath(relPath: string): string {
  return join(env.UPLOAD_DIR, relPath);
}

/**
 * Unterschriftsbild aufbereiten: Raster-Format prüfen, auf max. 800×320
 * verkleinern (Seitenverhältnis erhalten) und als PNG speichern (behält die
 * Transparenz eines durchsichtigen Hintergrunds). Rein optisch für die
 * Signatur-Box — kryptografisch irrelevant.
 */
export async function processAndSaveSignature(
  userId: number,
  input: Buffer,
): Promise<string> {
  const pipeline = sharp(input, { limitInputPixels: 24_000_000 });
  const meta = await pipeline.metadata();
  const allowed = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff"]);
  if (!meta.format || !allowed.has(meta.format)) {
    throw new Error("Nicht unterstütztes Bildformat.");
  }
  const out = await pipeline
    .rotate()
    .resize(800, 320, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const rel = join("signatures", `${userId}-${randomUUID()}.png`);
  const abs = signatureAbsPath(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, out);
  return rel;
}

export async function readSignature(relPath: string): Promise<Buffer | null> {
  try {
    return await readFile(signatureAbsPath(relPath));
  } catch {
    return null;
  }
}

export async function deleteSignatureFile(relPath: string): Promise<void> {
  try {
    await unlink(signatureAbsPath(relPath));
  } catch {
    /* schon weg */
  }
}
