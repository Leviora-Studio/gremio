// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  boardStatuses,
  cards,
  groups,
  protocolAreaAccess,
  protocolAreas,
  protocolCardLinks,
  protocolSessions,
  protocolTemplates,
  users,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { encryptSecret } from "@/lib/crypto";
import { isSafeExternalUrl } from "@/lib/url-guard";
import {
  createWebDavDirectoryExclusive,
  createWebDavTextExclusive,
  deleteWebDavEntry,
  joinWebDavPath,
  listWebDavDirectory,
  readWebDavText,
  overwriteWebDavText,
} from "@/lib/nextcloud";
import {
  extractFinanceLinks,
  renderDecisionRef,
  renderProtocolTemplate,
  renderSessionName,
  validateFilePattern,
} from "@/lib/protocol-markdown";
import {
  assertProtocolDeletionBoardAccess,
  cleanupDeletedProtocolResource,
  getProtocolSession,
  listProtocolSessionFiles,
  protocolCredentials,
  reconcileProtocolCardLinks,
  requireProtocolAreaAccess,
  requireProtocolAreaManage,
  syncProtocolSessions,
  syncProtocolSessionFile,
} from "@/lib/protocols";
import { protocolDeletionPath, resolveProtocolDeletionTarget } from "@/lib/protocol-deletion";
import { changeProtocolMembers, getProtocolMembers, type ProtocolMember, type ProtocolMemberCommand, type ProtocolMemberResult } from "@/lib/protocol-members";
import { syncProtocolAttendance } from "@/lib/protocol-markdown";
import { changeProtocolGuests, getProtocolGuests, type ProtocolGuest, type ProtocolGuestCommand, type ProtocolGuestResult } from "@/lib/protocol-guests";

export type ProtocolState = {
  error?: string;
  success?: string;
  etag?: string;
  savedToNextcloud?: boolean;
  content?: string;
};

export async function changeProtocolMembersAction(areaId: number, sessionId: number, command: ProtocolMemberCommand): Promise<ProtocolMemberResult> {
  const user = await requireUser();
  try {
    const members = await changeProtocolMembers(user, areaId, sessionId, command);
    return { members };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function changeProtocolGuestsAction(areaId: number, sessionId: number, command: ProtocolGuestCommand): Promise<ProtocolGuestResult> {
  const user = await requireUser();
  try { return { guests: await changeProtocolGuests(user, areaId, sessionId, command) }; }
  catch (error) { return { error: errorMessage(error) }; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

async function validateTemplate(id: number) {
  const [template] = await db.select().from(protocolTemplates).where(eq(protocolTemplates.id, id)).limit(1);
  if (!template) throw new Error("Bitte eine vorhandene Protokollvorlage wählen.");
  return template;
}

async function validateBoardLink(user: Awaited<ReturnType<typeof requireUser>>, boardId: number | null, statusId: number | null) {
  if (boardId == null && statusId == null) return;
  if (boardId == null || statusId == null) throw new Error("Board und Quellspalte müssen gemeinsam gewählt werden.");
  const board = await getBoardById(boardId);
  if (!board || board.inventoryBoardId != null || !(await canAccessBoard(user, board))) {
    throw new Error("Auf das gewählte Board besteht kein Zugriff.");
  }
  const [status] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)))
    .limit(1);
  if (!status) throw new Error("Die Quellspalte gehört nicht zum gewählten Board.");
}

function validateConfig(formData: FormData, currentPassword?: string) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const ncUrl = String(formData.get("ncUrl") ?? "").trim();
  const ncUsername = String(formData.get("ncUsername") ?? "").trim();
  const rootPath = String(formData.get("rootPath") ?? "").trim();
  const folderPattern = String(formData.get("folderPattern") ?? "").trim();
  const filePattern = String(formData.get("filePattern") ?? "").trim();
  const decisionRefPattern = String(formData.get("decisionRefPattern") ?? "").trim();
  const password = String(formData.get("ncPassword") ?? "") || currentPassword || "";
  const templateId = Number(formData.get("templateId"));
  const rawBoard = String(formData.get("boardId") ?? "");
  const rawStatus = String(formData.get("sourceStatusId") ?? "");
  const boardId = rawBoard ? Number(rawBoard) : null;
  const sourceStatusId = rawStatus ? Number(rawStatus) : null;
  if (!name || !ncUrl || !ncUsername || !password || !rootPath) throw new Error("Name und vollständige Nextcloud-Verbindung sind erforderlich.");
  if (!isSafeExternalUrl(ncUrl) || new URL(ncUrl).protocol !== "https:") throw new Error("Die Nextcloud-URL muss eine öffentliche HTTPS-Adresse sein.");
  if (!rootPath.startsWith("/") || /(^|\/)\.\.?(\/|$)|[\\\0?#]/.test(rootPath)) {
    throw new Error("Der WebDAV-Wurzelpfad muss ein absoluter, sicherer Pfad ohne . oder .. sein.");
  }
  renderSessionName(folderPattern, "2026-08-14", name);
  const sampleFolder = renderSessionName(folderPattern, "2026-08-14", name);
  validateFilePattern(filePattern, "2026-08-14", name, sampleFolder);
  if (!decisionRefPattern) throw new Error("Das Beschlussreferenz-Muster ist erforderlich.");
  renderDecisionRef(decisionRefPattern, sampleFolder, "2026-08-14", "5.1");
  return { name: name.slice(0, 120), description, ncUrl, ncUsername, password, rootPath, folderPattern, filePattern, decisionRefPattern, templateId, boardId, sourceStatusId };
}

export async function createProtocolAreaAction(_prev: ProtocolState, formData: FormData): Promise<ProtocolState> {
  const user = await requireUser();
  let value: ReturnType<typeof validateConfig>;
  try {
    value = validateConfig(formData);
    await validateTemplate(value.templateId);
    await validateBoardLink(user, value.boardId, value.sourceStatusId);
    try {
      await listWebDavDirectory(
        { url: value.ncUrl, username: value.ncUsername, password: value.password },
        value.rootPath,
      );
    } catch (error) {
      throw new Error(`Nextcloud-Verbindung fehlgeschlagen: ${errorMessage(error)}`);
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
  const { password, ...config } = value;
  const [area] = await db
    .insert(protocolAreas)
    .values({
      ...config,
      ownerId: user.id,
      ncPasswordEnc: encryptSecret(password),
    })
    .returning({ id: protocolAreas.id });
  redirect(`/intern/protokolle/${area.id}`);
}

export async function updateProtocolAreaAction(areaId: number, _prev: ProtocolState, formData: FormData): Promise<ProtocolState> {
  const { user, area } = await requireProtocolAreaManage(areaId);
  try {
    const value = validateConfig(formData, "__KEEP__");
    await validateTemplate(value.templateId);
    await validateBoardLink(user, value.boardId, value.sourceStatusId);
    const newPassword = String(formData.get("ncPassword") ?? "");
    const ncPasswordEnc = newPassword ? encryptSecret(newPassword) : area.ncPasswordEnc;
    const passwordForTest = newPassword || protocolCredentials(area).password;
    try {
      await listWebDavDirectory(
        { url: value.ncUrl, username: value.ncUsername, password: passwordForTest },
        value.rootPath,
      );
    } catch (error) {
      throw new Error(`Nextcloud-Verbindung fehlgeschlagen: ${errorMessage(error)}`);
    }
    await db
      .update(protocolAreas)
      .set({
        name: value.name,
        description: value.description,
        ncUrl: value.ncUrl,
        ncUsername: value.ncUsername,
        ncPasswordEnc,
        rootPath: value.rootPath,
        folderPattern: value.folderPattern,
        filePattern: value.filePattern,
        templateId: value.templateId,
        boardId: value.boardId,
        sourceStatusId: value.sourceStatusId,
        decisionRefPattern: value.decisionRefPattern,
      })
      .where(eq(protocolAreas.id, areaId));
    revalidatePath(`/intern/protokolle/${areaId}`);
    return { success: "Einstellungen und Verbindung geprüft und gespeichert." };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function syncProtocolAreaAction(areaId: number, _prev: ProtocolState): Promise<ProtocolState> {
  const { area } = await requireProtocolAreaAccess(areaId);
  try {
    await syncProtocolSessions(area);
    revalidatePath(`/intern/protokolle/${areaId}`);
    return { success: "Nextcloud-Abgleich abgeschlossen." };
  } catch (error) {
    return { error: `Nextcloud-Abgleich fehlgeschlagen: ${errorMessage(error)}` };
  }
}

export async function createSessionAction(areaId: number, _prev: ProtocolState, formData: FormData): Promise<ProtocolState> {
  const { area } = await requireProtocolAreaAccess(areaId);
  const date = String(formData.get("date") ?? "");
  try {
    const template = await validateTemplate(area.templateId);
    const folderName = renderSessionName(area.folderPattern, date, area.name);
    const fileName = validateFilePattern(area.filePattern, date, area.name, folderName);
    const creds = protocolCredentials(area);
    const folderPath = joinWebDavPath(area.rootPath, folderName);
    const createdFolder = await createWebDavDirectoryExclusive(creds, folderPath);
    if (!createdFolder) {
      const sessions = await syncProtocolSessions(area);
      const existing = sessions.find((session) => session.folderName === folderName);
      if (existing) redirect(`/intern/protokolle/${areaId}/sitzung/${existing.id}?existing=1`);
      throw new Error("Der Sitzungsordner existiert bereits und wurde nicht verändert.");
    }
    const content = renderProtocolTemplate(template.markdown, {
      "session.date": date,
      "session.date_de": date.split("-").reverse().join("."),
      "session.folder_name": folderName,
      "protocol_area.name": area.name,
      created_at: new Date().toISOString(),
    });
    const createdFile = await createWebDavTextExclusive(creds, joinWebDavPath(folderPath, fileName), content);
    if (!createdFile.created) throw new Error("Die Protokolldatei existiert bereits und wurde nicht überschrieben.");
    const sessions = await syncProtocolSessions(area);
    const session = sessions.find((item) => item.folderName === folderName);
    if (!session) throw new Error("Die Sitzung wurde angelegt, konnte aber nicht registriert werden. Bitte synchronisieren.");
    redirect(`/intern/protokolle/${areaId}/sitzung/${session.id}`);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    return { error: errorMessage(error) };
  }
}

export async function createProtocolForSessionAction(areaId: number, sessionId: number, _prev: ProtocolState, formData: FormData): Promise<ProtocolState> {
  const { area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session) return { error: "Sitzung nicht gefunden." };
  const date = String(formData.get("date") ?? session.sessionDate ?? "");
  const templateId = Number(formData.get("templateId") || area.templateId);
  try {
    const template = await validateTemplate(templateId);
    const fileName = validateFilePattern(area.filePattern, date, area.name, session.folderName);
    const path = joinWebDavPath(area.rootPath, session.folderName, fileName);
    const content = renderProtocolTemplate(template.markdown, {
      "session.date": date,
      "session.date_de": date.split("-").reverse().join("."),
      "session.folder_name": session.folderName,
      "protocol_area.name": area.name,
      created_at: new Date().toISOString(),
    });
    const result = await createWebDavTextExclusive(protocolCredentials(area), path, content);
    if (!result.created) {
      const files = await listProtocolSessionFiles(area, session);
      const updated = await syncProtocolSessionFile(area, { ...session, sessionDate: date }, files);
      revalidatePath(`/intern/protokolle/${areaId}`);
      revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
      return updated.protocolPath
        ? { success: "Die vorhandene Protokolldatei wurde erkannt und nicht überschrieben." }
        : { error: "Die Protokolldatei konnte nicht angelegt oder als Datei erkannt werden. Bitte die Nextcloud-Dateiliste prüfen." };
    }
    await db.update(protocolSessions).set({
      sessionDate: date,
      protocolPath: path,
      protocolFileId: result.stat?.fileId ?? null,
      protocolEtag: result.stat?.etag ?? null,
      protocolLastModified: result.stat?.lastModified ? new Date(result.stat.lastModified) : null,
      lastSyncedAt: new Date(),
    }).where(eq(protocolSessions.id, sessionId));
    revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
    return { success: "Protokoll in Nextcloud angelegt." };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function deleteProtocolFileAction(
  areaId: number,
  sessionId: number,
  expectedFolderName: string,
  fileName: string,
  expectedFileId: string | null,
): Promise<ProtocolState> {
  const { user, area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session) return { error: "Sitzung nicht gefunden." };
  if (session.folderName !== expectedFolderName) return { error: "Der Sitzungsordner wurde umbenannt. Bitte neu laden." };
  let cloudDeleted = false;
  try {
    const folderPath = protocolDeletionPath(area.rootPath, session.folderName);
    const path = protocolDeletionPath(area.rootPath, session.folderName, fileName);
    let isProtocol = session.protocolPath === path;
    const creds = protocolCredentials(area);
    const folder = resolveProtocolDeletionTarget(
      await listWebDavDirectory(creds, area.rootPath),
      session.folderName,
      "directory",
      session.folderFileId,
    );
    const file = folder ? resolveProtocolDeletionTarget(
      await listWebDavDirectory(creds, folderPath),
      fileName,
      "file",
      (isProtocol ? session.protocolFileId : null) || expectedFileId,
    ) : null;
    if (file?.fileId && file.fileId === session.protocolFileId) isProtocol = true;
    if (isProtocol) await assertProtocolDeletionBoardAccess(user, session);
    if (file) await deleteWebDavEntry(creds, path, file.etag);
    cloudDeleted = true;
    const cardIds = isProtocol ? await cleanupDeletedProtocolResource(user, session, "protocol") : [];
    for (const cardId of cardIds) revalidatePath(`/intern/card/${cardId}`);
    revalidatePath(`/intern/protokolle/${areaId}`);
    revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
    return { success: "Datei in Nextcloud gelöscht." };
  } catch (error) {
    return { error: cloudDeleted
      ? `Die Datei ist in Nextcloud nicht mehr vorhanden, aber die lokale Bereinigung ist fehlgeschlagen: ${errorMessage(error)} Bitte diese Löschaktion erneut ausführen.`
      : `Datei konnte nicht gelöscht werden: ${errorMessage(error)}` };
  }
}

export async function deleteProtocolSessionAction(
  areaId: number,
  sessionId: number,
  expectedFolderName: string,
): Promise<ProtocolState> {
  const { user, area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session) return { error: "Sitzung nicht gefunden. Bitte die Übersicht neu laden." };
  if (session.folderName !== expectedFolderName) return { error: "Der Sitzungsordner wurde umbenannt. Bitte neu laden." };
  let cloudDeleted = false;
  try {
    const path = protocolDeletionPath(area.rootPath, session.folderName);
    await assertProtocolDeletionBoardAccess(user, session);
    const creds = protocolCredentials(area);
    const folder = resolveProtocolDeletionTarget(
      await listWebDavDirectory(creds, area.rootPath),
      session.folderName,
      "directory",
      session.folderFileId,
    );
    if (folder) await deleteWebDavEntry(creds, path, folder.etag);
    cloudDeleted = true;
    const cardIds = await cleanupDeletedProtocolResource(user, session, "session");
    for (const cardId of cardIds) revalidatePath(`/intern/card/${cardId}`);
    revalidatePath(`/intern/protokolle/${areaId}`);
    revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
  } catch (error) {
    return { error: cloudDeleted
      ? `Der Sitzungsordner ist in Nextcloud nicht mehr vorhanden, aber die lokale Bereinigung ist fehlgeschlagen: ${errorMessage(error)} Bitte diese Löschaktion erneut ausführen.`
      : `Sitzungsordner konnte nicht gelöscht werden: ${errorMessage(error)}` };
  }
  redirect(`/intern/protokolle/${areaId}`);
}

export async function saveProtocolAction(areaId: number, sessionId: number, content: string, replannedCardIds: number[] = []): Promise<ProtocolState> {
  const { user, area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session?.protocolPath) return { error: "Keine Protokolldatei registriert." };
  const [members, guests] = await Promise.all([getProtocolMembers(areaId, sessionId), getProtocolGuests(areaId, sessionId)]);
  content = syncProtocolAttendance(content, members, guests);
  const links = extractFinanceLinks(content);
  if (!Array.isArray(replannedCardIds) || replannedCardIds.length > links.length || replannedCardIds.some(id => !Number.isSafeInteger(id) || !links.some(link => link.cardId === id))) {
    return { error: "Ungültige neu eingeplante Finanzanträge." };
  }
  let mayReconcile = true;

  if (!area.boardId && links.length) {
    return { error: "Das Protokoll enthält Finanzverknüpfungen, aber der Protokollbereich hat kein verknüpftes Board." };
  }
  if (area.boardId) {
    const board = await getBoardById(area.boardId);
    const mayLink = !!board && (await canAccessBoard(user, board));
    const ids = [...new Set(links.map((link) => link.cardId))];
    const valid = ids.length
      ? await db.select({ id: cards.id }).from(cards).where(and(eq(cards.boardId, area.boardId), inArray(cards.id, ids)))
      : [];
    if (valid.length !== ids.length) {
      return { error: "Mindestens eine Markdown-Verknüpfung gehört nicht zum konfigurierten Board." };
    }
    if (!mayLink) {
      if (replannedCardIds.length) return { error: "Zum erneuten Einplanen ist Zugriff auf das verknüpfte Board erforderlich." };
      const existing = await db.select({ cardId: protocolCardLinks.cardId, top: protocolCardLinks.top }).from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
      const normalized = (items: typeof existing) => JSON.stringify([...items].sort((a, b) => a.cardId - b.cardId));
      if (normalized(existing) !== normalized(links)) return { error: "Finanzverknüpfungen dürfen nur mit Zugriff auf das verknüpfte Board geändert werden." };
      mayReconcile = false;
    }
  }

  let stat;
  try {
    stat = await overwriteWebDavText(protocolCredentials(area), session.protocolPath, content);
  } catch (error) {
    return { error: `Speichern in Nextcloud fehlgeschlagen: ${errorMessage(error)}` };
  }
  try {
    await db.update(protocolSessions).set({
      protocolEtag: stat.etag,
      protocolFileId: stat.fileId,
      protocolLastModified: stat.lastModified ? new Date(stat.lastModified) : null,
      lastSyncedAt: new Date(),
    }).where(eq(protocolSessions.id, session.id));
    if (!mayReconcile) {
      return {
        success: "In Nextcloud gespeichert. Bestehende Finanzverknüpfungen wurden mangels Board-Zugriff nicht verändert.",
        etag: stat.etag ?? (stat.lastModified ? `lastmod:${stat.lastModified}` : undefined),
        savedToNextcloud: true,
        content,
      };
    }
    const result = await reconcileProtocolCardLinks(area, session, links, replannedCardIds);
    revalidatePath(`/intern/protokolle/${areaId}/sitzung/${sessionId}`);
    return {
      success: result.conflicts
        ? `In Nextcloud gespeichert. ${result.conflicts} manuell geänderte Beschlussreferenz(en) wurden nicht überschrieben.`
        : "In Nextcloud gespeichert.",
      etag: stat.etag ?? (stat.lastModified ? `lastmod:${stat.lastModified}` : undefined),
      savedToNextcloud: true,
      content,
    };
  } catch (error) {
    return {
      error: `Die Datei wurde in Nextcloud gespeichert, aber die Kartenverknüpfung ist noch nicht konsistent: ${errorMessage(error)} Erneutes Speichern wiederholt die Nachbearbeitung idempotent.`,
      etag: stat.etag ?? (stat.lastModified ? `lastmod:${stat.lastModified}` : undefined),
      savedToNextcloud: true,
      content,
    };
  }
}

export async function loadProtocolDocumentAction(areaId: number, sessionId: number): Promise<{ content?: string; etag?: string; error?: string; members?: ProtocolMember[]; guests?: ProtocolGuest[] }> {
  const { area } = await requireProtocolAreaAccess(areaId);
  const session = await getProtocolSession(areaId, sessionId);
  if (!session?.protocolPath) return { error: "Keine Protokolldatei registriert." };
  try {
    const result = await readWebDavText(protocolCredentials(area), session.protocolPath);
    return {
      content: result.content,
      members: await getProtocolMembers(areaId, sessionId),
      guests: await getProtocolGuests(areaId, sessionId),
      etag: result.stat.etag ?? (result.stat.lastModified ? `lastmod:${result.stat.lastModified}` : ""),
    };
  } catch (error) {
    return { error: `Laden aus Nextcloud fehlgeschlagen: ${errorMessage(error)}` };
  }
}

export async function addProtocolAreaUserAccessAction(areaId: number, formData: FormData): Promise<void> {
  await requireProtocolAreaManage(areaId);
  const userId = Number(formData.get("userId"));
  const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.isActive, true))).limit(1);
  if (user) await db.insert(protocolAreaAccess).values({ areaId, userId }).onConflictDoNothing();
  revalidatePath(`/intern/protokolle/${areaId}/einstellungen`);
}

export async function addProtocolAreaGroupAccessAction(areaId: number, formData: FormData): Promise<void> {
  await requireProtocolAreaManage(areaId);
  const groupId = Number(formData.get("groupId"));
  const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).limit(1);
  if (group) await db.insert(protocolAreaAccess).values({ areaId, groupId }).onConflictDoNothing();
  revalidatePath(`/intern/protokolle/${areaId}/einstellungen`);
}

export async function removeProtocolAreaAccessAction(areaId: number, accessId: number): Promise<void> {
  await requireProtocolAreaManage(areaId);
  await db.delete(protocolAreaAccess).where(and(eq(protocolAreaAccess.id, accessId), eq(protocolAreaAccess.areaId, areaId)));
  revalidatePath(`/intern/protokolle/${areaId}/einstellungen`);
}

export async function transferProtocolAreaOwnerAction(areaId: number, formData: FormData): Promise<void> {
  await requireProtocolAreaManage(areaId);
  const ownerId = Number(formData.get("ownerId"));
  const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.isActive, true))).limit(1);
  if (owner) await db.update(protocolAreas).set({ ownerId }).where(eq(protocolAreas.id, areaId));
  revalidatePath(`/intern/protokolle/${areaId}/einstellungen`);
}
