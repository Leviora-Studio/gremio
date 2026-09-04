// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { protocolDeletionPath } from "@/lib/protocol-deletion";

/** Relative folders are validated segment by segment, never normalized across a session boundary. */
export function protocolSubfolderSegments(subfolder: string): string[] {
  if (typeof subfolder !== "string" || subfolder.length > 4096) throw new Error("Ungültiger Unterordner.");
  if (!subfolder) return [];
  const segments = subfolder.split("/");
  for (const segment of segments) protocolDeletionPath("/", segment);
  return segments;
}

export function protocolDirectoryPath(rootPath: string, folderName: string, subfolder = ""): string {
  return [protocolDeletionPath(rootPath, folderName), ...protocolSubfolderSegments(subfolder)].join("/");
}

export function protocolFilePath(rootPath: string, folderName: string, filename: string, subfolder = ""): string {
  protocolDeletionPath("/", filename);
  return `${protocolDirectoryPath(rootPath, folderName, subfolder)}/${filename}`;
}

export function protocolFolderHref(areaId: number, sessionId: number, subfolder = ""): string {
  protocolSubfolderSegments(subfolder);
  return `/intern/protokolle/${areaId}/sitzung/${sessionId}${subfolder ? `?folder=${encodeURIComponent(subfolder)}` : ""}`;
}
