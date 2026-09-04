// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import type { WebDavEntry } from "@/lib/nextcloud";

/** Löschziele sind ausschließlich direkte Kinder des konfigurierten Bereichs. */
export function protocolDeletionPath(rootPath: string, folderName: string, fileName?: string): string {
  if (!rootPath.startsWith("/") || /[\\\x00-\x1f\x7f?#]|__PATH_SEPARATOR_(?:POSIX|WINDOWS)__/.test(rootPath)) {
    throw new Error("Ungültiger WebDAV-Wurzelpfad.");
  }
  const rootSegments = rootPath.split("/").filter(Boolean);
  if (rootSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Unsicherer WebDAV-Wurzelpfad.");
  }
  const children = fileName === undefined ? [folderName] : [folderName, fileName];
  // Keine Namen, die normalizeBase trimmt oder der WebDAV-Encoder als interne
  // Pfadtrenner-Marker interpretiert: Das tatsächlich adressierte Ziel muss exakt bleiben.
  if (children.some((name) => !name || name !== name.trim() || name === "." || name === ".." || /[\\/\x00-\x1f\x7f]|__PATH_SEPARATOR_(?:POSIX|WINDOWS)__/.test(name))) {
    throw new Error("Das Löschziel muss ein eindeutiger Datei- oder Sitzungsordnername sein.");
  }
  return `/${[...rootSegments, ...children].join("/")}`;
}

/** Nie ein umbenanntes, ersetztes oder zum Ordner gewordenes Ziel blind löschen. */
export function resolveProtocolDeletionTarget(
  entries: WebDavEntry[],
  name: string,
  type: WebDavEntry["type"],
  expectedFileId: string | null,
): WebDavEntry | null {
  const target = entries.find((entry) => entry.name === name);
  if (!target) {
    if (expectedFileId && entries.some((entry) => entry.fileId === expectedFileId)) {
      throw new Error("Das Löschziel wurde umbenannt. Bitte synchronisieren und erneut auswählen.");
    }
    return null;
  }
  if (target.type !== type) throw new Error("Der Typ des Löschziels hat sich geändert. Bitte neu laden.");
  if (expectedFileId && !target.fileId) {
    throw new Error("Die Identität des Löschziels konnte nicht bestätigt werden. Bitte erneut synchronisieren.");
  }
  if (expectedFileId && expectedFileId !== target.fileId) {
    throw new Error("Unter diesem Namen liegt inzwischen ein anderes Löschziel. Bitte neu laden.");
  }
  return target;
}
