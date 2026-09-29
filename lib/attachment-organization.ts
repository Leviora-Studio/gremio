// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { sanitizeSingleLine } from "@/lib/text";

export type AttachmentFolder = { id: number; name: string };

/** Keep newly entered names portable and unchanged in the cloud archive. */
export function organizationName(raw: unknown): string | null {
  if (typeof raw !== "string" || /[\x00-\x1f\x7f]/.test(raw)) return null;
  const name = sanitizeSingleLine(raw).normalize("NFC");
  if (!name || name.length > 120 || Buffer.byteLength(name, "utf8") > 255 ||
      /[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) || name.startsWith(".") ||
      name.endsWith(".") || name.includes("..")) return null;
  return name;
}

export function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, "_")
    .replace(/\.{2,}/g, "_").replace(/^\.+/, "")
    .replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "ordner";
}

/** Shared cloud/ZIP layout; never overwrite colliding legacy filenames. */
export function attachmentArchiveLayout<T extends { id: number; filename: string; folderId: number | null }>(
  folders: AttachmentFolder[], files: T[],
): { directories: string[]; files: { attachment: T; name: string }[] } {
  function reserve(raw: string, id: number, used: Set<string>): string {
    const name = sanitizeSegment(raw);
    const shorten = (value: string, budget: number) => {
      let result = "";
      for (const char of value) {
        if (Buffer.byteLength(result + char) > budget) break;
        result += char;
      }
      return result;
    };
    let candidate = shorten(name, 255);
    let count = 0;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      const suffix = ` (${id}${count++ ? `-${count}` : ""})${ext}`;
      candidate = `${shorten(base, 255 - Buffer.byteLength(suffix))}${suffix}`;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    return candidate;
  }
  const rootUsed = new Set<string>();
  const names = new Map<number, string>();
  for (const folder of [...folders].sort((a, b) => a.id - b.id)) {
    names.set(folder.id, reserve(folder.name, folder.id, rootUsed));
  }
  const folderUsed = new Map<number, Set<string>>();
  const entries = [...files].sort((a, b) => a.id - b.id).map((attachment) => {
    const folder = attachment.folderId == null ? null : names.get(attachment.folderId);
    if (attachment.folderId != null && !folder) throw new Error("Unknown attachment folder");
    const occupied = folder ? (folderUsed.get(attachment.folderId!) ?? new Set<string>()) : rootUsed;
    const filename = reserve(attachment.filename, attachment.id, occupied);
    if (folder) folderUsed.set(attachment.folderId!, occupied);
    return { attachment, name: folder ? `${folder}/${filename}` : filename };
  });
  return { directories: [...names.values()], files: entries };
}
