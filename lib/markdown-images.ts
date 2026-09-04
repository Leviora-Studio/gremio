// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { protocolSubfolderSegments } from "@/lib/protocol-paths";
import type { MarkdownEdit, MarkdownSelection } from "@/lib/markdown-formatting";

/** Resolve local image references without allowing remote requests or parent traversal. */
export function markdownImageLocation(reference: string, subfolder = "") {
  try {
    if (/^[a-z][a-z\d+.-]*:|^[\\/]|[?#]/i.test(reference)) return null;
    const segments = reference.replace(/^\.\//, "").split("/").map(segment => decodeURIComponent(segment));
    for (const segment of segments) {
      if (segment.includes("/")) return null;
      protocolSubfolderSegments(segment);
      if (!segment) return null;
    }
    const filename = segments.at(-1)!;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(filename)) return null;
    const folder = [...protocolSubfolderSegments(subfolder), ...segments.slice(0, -1)].join("/");
    return { filename, subfolder: folder, relativePath: segments.join("/") };
  } catch { return null; }
}

export function markdownImageUrl(reference: string, areaId: number, sessionId: number, subfolder = "") {
  const target = markdownImageLocation(reference, subfolder);
  return target ? `/api/protokolle/${areaId}/sitzung/${sessionId}/image?name=${encodeURIComponent(target.filename)}&folder=${encodeURIComponent(target.subfolder)}` : null;
}

export type MarkdownImageUploadResult = { error?: string; reference?: string; alt?: string };

export function resizedMarkdownImage(source: string, width: number) {
  if (!Number.isFinite(width)) throw new Error("Ungültige Bildbreite.");
  if (!/^!\[(?:\\.|[^\]\\])*\]\([^\s)]+\)(?:\{\s*width=\d{1,4}\s*\})?$/.test(source)) throw new Error("Ungültiger Bildverweis.");
  return source.replace(/\{\s*width=\d{1,4}\s*\}$/, "") + `{width=${Math.max(48, Math.min(1600, Math.round(width)))}}`;
}

export function insertMarkdownImage(source: string, selection: MarkdownSelection, reference: string, alt: string): MarkdownEdit {
  if (!markdownImageLocation(reference)) throw new Error("Ungültiger Bildverweis.");
  const label = alt.replace(/[\r\n]/g, " ").replace(/[\\\[\]]/g, "\\$&");
  const image = `![${label}](${reference})`;
  const start = Math.max(0, Math.min(source.length, selection.start));
  const end = Math.max(start, Math.min(source.length, selection.end));
  const before = source.slice(0, start); const after = source.slice(end);
  const inTable = /^\s*\|/.test(source.slice(source.lastIndexOf("\n", Math.max(0, start - 1)) + 1, start));
  const prefix = inTable || !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = inTable ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const markdown = before + prefix + image + suffix + after;
  const caret = before.length + prefix.length + image.length + suffix.length;
  return { markdown, selection: { start: caret, end: caret } };
}
