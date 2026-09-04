// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

const imageTypes = new Map<string, string>([["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"]]);

/** Raster formats only: SVG/HTML must never be served inline from our origin. */
export function protocolImageMime(filename: string, mime: string | null): string | null {
  const declared = mime?.split(";")[0].trim().toLowerCase();
  return imageTypes.get(filename.split(".").pop()?.toLowerCase() ?? "")
    ?? (declared && [...imageTypes.values()].includes(declared) ? declared : null);
}

export function detectProtocolImageMime(bytes: Uint8Array): string | null {
  const prefix = (expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
  if (prefix([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (prefix([255, 216, 255])) return "image/jpeg";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
