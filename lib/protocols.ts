// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  boardStatuses,
  cards,
  priorities,
  protocolAreaAccess,
  protocolAreas,
  protocolCardLinks,
  protocolSessions,
  type ProtocolArea,
  type ProtocolSession,
  type User,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById, getUserGroupIds } from "@/lib/authz";
import { decryptSecret } from "@/lib/crypto";
import {
  joinWebDavPath,
  listWebDavDirectory,
  type NcCredentials,
  type WebDavEntry,
} from "@/lib/nextcloud";
import {
  mayReplaceDecisionRef,
  renderDecisionRef,
  validateFilePattern,
} from "@/lib/protocol-markdown";

export async function getProtocolAreaById(id: number): Promise<ProtocolArea | undefined> {
  if (!Number.isInteger(id)) return undefined;
  const [area] = await db.select().from(protocolAreas).where(eq(protocolAreas.id, id)).limit(1);
  return area;
}

export async function canAccessProtocolArea(user: User, area: ProtocolArea): Promise<boolean> {
  if (user.role === "admin" || area.ownerId === user.id) return true;
  const groupIds = await getUserGroupIds(user.id);
  const rows = await db
    .select({ id: protocolAreaAccess.id })
    .from(protocolAreaAccess)
    .where(
      and(
        eq(protocolAreaAccess.areaId, area.id),
        or(
          eq(protocolAreaAccess.userId, user.id),
          groupIds.length ? inArray(protocolAreaAccess.groupId, groupIds) : undefined,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export function canManageProtocolArea(user: User, area: ProtocolArea): boolean {
  return user.role === "admin" || area.ownerId === user.id;
}

export async function getAccessibleProtocolAreas(user: User): Promise<ProtocolArea[]> {
  if (user.role === "admin") return db.select().from(protocolAreas).orderBy(protocolAreas.name);
  const groupIds = await getUserGroupIds(user.id);
  const owned = await db.select({ id: protocolAreas.id }).from(protocolAreas).where(eq(protocolAreas.ownerId, user.id));
  const direct = await db.select({ id: protocolAreaAccess.areaId }).from(protocolAreaAccess).where(eq(protocolAreaAccess.userId, user.id));
  const grouped = groupIds.length
    ? await db.select({ id: protocolAreaAccess.areaId }).from(protocolAreaAccess).where(inArray(protocolAreaAccess.groupId, groupIds))
    : [];
  const ids = [...new Set([...owned, ...direct, ...grouped].map((r) => r.id))];
  if (!ids.length) return [];
  return db.select().from(protocolAreas).where(inArray(protocolAreas.id, ids)).orderBy(protocolAreas.name);
}

export async function requireProtocolAreaAccess(id: number): Promise<{ user: User; area: ProtocolArea }> {
  const user = await requireUser();
  const area = await getProtocolAreaById(id);
  if (!area || !(await canAccessProtocolArea(user, area))) notFound();
  return { user, area };
}

export async function requireProtocolAreaManage(id: number): Promise<{ user: User; area: ProtocolArea }> {
  const user = await requireUser();
  const area = await getProtocolAreaById(id);
  if (!area || !canManageProtocolArea(user, area)) notFound();
  return { user, area };
}

export function protocolCredentials(area: ProtocolArea): NcCredentials {
  return {
    url: area.ncUrl,
    username: area.ncUsername,
    password: decryptSecret(area.ncPasswordEnc),
  };
}

function inferSessionDate(folderName: string): string | null {
  const match = /(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?:[^\d]|$)/.exec(folderName);
  if (!match) return null;
  const date = new Date(`${match[1]}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]
    ? null
    : match[1];
}

function safeProtocolFilename(
  area: Pick<ProtocolArea, "filePattern" | "name">,
  folder: string,
  date: string | null,
): string | null {
  if (!date && /\{(?:YYYY|MM|DD|date)\}/.test(area.filePattern)) return null;
  try {
    return validateFilePattern(area.filePattern, date ?? "1970-01-01", area.name, folder);
  } catch {
    return null;
  }
}

type SessionDiscoveryArea = Pick<ProtocolArea, "id" | "name" | "filePattern">;
type ExistingSessionIdentity = Pick<
  ProtocolSession,
  "id" | "folderName" | "folderFileId" | "protocolFileId"
> & Partial<Pick<ProtocolSession, "sessionDate" | "protocolPath">>;

/** Gemeinsame Dateierkennung für Übersicht und direkt geladene Sitzungen. */
export function deriveProtocolFileMetadata(
  area: Pick<ProtocolArea, "name" | "filePattern">,
  session: Pick<ProtocolSession, "folderName" | "sessionDate" | "protocolFileId"> & Partial<Pick<ProtocolSession, "protocolPath">>,
  files: WebDavEntry[],
) {
  const expected = safeProtocolFilename(area, session.folderName, session.sessionDate ?? inferSessionDate(session.folderName));
  const protocolFile =
    (expected ? files.find((file) => file.type === "file" && file.name === expected) : undefined) ??
    (session.protocolFileId ? files.find((file) => file.type === "file" && file.fileId === session.protocolFileId) : undefined) ??
    (session.protocolPath ? files.find((file) => file.type === "file" && file.path === session.protocolPath) : undefined);
  return {
    protocolPath: protocolFile?.path ?? null,
    protocolFileId: protocolFile?.fileId ?? null,
    protocolEtag: protocolFile?.etag ?? null,
    protocolLastModified: protocolFile?.lastModified ? new Date(protocolFile.lastModified) : null,
  };
}

/** Erst nach erfolgreichem Listing aktualisieren; Cloud-Fehler löschen keine Metadaten. */
export async function syncProtocolSessionFile(
  area: ProtocolArea,
  session: ProtocolSession,
  files: WebDavEntry[],
): Promise<ProtocolSession> {
  const [updated] = await db.update(protocolSessions).set({
    ...deriveProtocolFileMetadata(area, session, files),
    sessionDate: session.sessionDate ?? inferSessionDate(session.folderName),
    lastSyncedAt: new Date(),
  }).where(and(eq(protocolSessions.id, session.id), eq(protocolSessions.areaId, area.id))).returning();
  if (!updated) throw new Error("Sitzung nicht mehr vorhanden. Bitte die Übersicht neu laden.");
  return updated;
}

/**
 * Leitet ausschließlich technische Metadaten aus einem Nextcloud-Ordner ab.
 * Der reine Kern hält die Synchronisationsregeln ohne WebDAV-/DB-Seiteneffekte
 * testbar: stabile Datei-IDs haben Vorrang, Pfade/Namen sind der Fallback.
 */
export function deriveProtocolSessionDiscovery(
  area: SessionDiscoveryArea,
  existingSessions: ExistingSessionIdentity[],
  folder: WebDavEntry,
  children: WebDavEntry[],
  syncedAt: Date,
): {
  existingId: number | null;
  values: typeof protocolSessions.$inferInsert;
} {
  const existing =
    (folder.fileId
      ? existingSessions.find((session) => session.folderFileId === folder.fileId)
      : undefined) ??
    existingSessions.find((session) => session.folderName === folder.name);
  const sessionDate = inferSessionDate(folder.name) ?? existing?.sessionDate ?? null;
  return {
    existingId: existing?.id ?? null,
    values: {
      areaId: area.id,
      folderName: folder.name,
      sessionDate,
      folderFileId: folder.fileId,
      folderEtag: folder.etag,
      ...deriveProtocolFileMetadata(area, {
        folderName: folder.name,
        sessionDate,
        protocolFileId: existing?.protocolFileId ?? null,
        protocolPath: existing?.protocolPath,
      }, children),
      lastSyncedAt: syncedAt,
    },
  };
}

/** Liest die Nextcloud-Wurzel und registriert/aktualisiert nur technische Metadaten. */
export async function syncProtocolSessions(area: ProtocolArea): Promise<ProtocolSession[]> {
  const creds = protocolCredentials(area);
  const root = await listWebDavDirectory(creds, area.rootPath);
  const folders = root.filter((item) => item.type === "directory");
  const now = new Date();
  const existingSessions = await db
    .select()
    .from(protocolSessions)
    .where(eq(protocolSessions.areaId, area.id));

  for (const folder of folders) {
    const children = await listWebDavDirectory(creds, folder.path);
    const discovery = deriveProtocolSessionDiscovery(
      area,
      existingSessions,
      folder,
      children,
      now,
    );
    if (discovery.existingId) {
      await db
        .update(protocolSessions)
        .set(discovery.values)
        .where(eq(protocolSessions.id, discovery.existingId));
    } else {
      await db.insert(protocolSessions).values(discovery.values).onConflictDoUpdate({
        target: [protocolSessions.areaId, protocolSessions.folderName],
        set: discovery.values,
      });
    }
  }

  if (!folders.length) return [];
  return db
    .select()
    .from(protocolSessions)
    .where(
      and(
        eq(protocolSessions.areaId, area.id),
        inArray(protocolSessions.folderName, folders.map((f) => f.name)),
      ),
    )
    .orderBy(asc(protocolSessions.folderName));
}

export async function getProtocolSession(
  areaId: number,
  sessionId: number,
): Promise<ProtocolSession | undefined> {
  if (!Number.isInteger(sessionId)) return undefined;
  const [session] = await db
    .select()
    .from(protocolSessions)
    .where(and(eq(protocolSessions.id, sessionId), eq(protocolSessions.areaId, areaId)))
    .limit(1);
  return session;
}

export async function listProtocolSessionFiles(
  area: ProtocolArea,
  session: ProtocolSession,
): Promise<WebDavEntry[]> {
  return listWebDavDirectory(
    protocolCredentials(area),
    joinWebDavPath(area.rootPath, session.folderName),
  );
}

export type ProtocolSuggestion = {
  id: number;
  number: string | null;
  title: string;
  applicant: string;
  amount: number | null;
  priority: string | null;
  assignedSession: string | null;
};

export function sortProtocolSuggestions(
  suggestions: ProtocolSuggestion[],
): ProtocolSuggestion[] {
  return [...suggestions].sort(
    (a, b) => Number(!!a.assignedSession) - Number(!!b.assignedSession),
  );
}

export async function getProtocolSuggestions(
  user: User,
  area: ProtocolArea,
): Promise<ProtocolSuggestion[]> {
  if (!area.boardId || !area.sourceStatusId) return [];
  const board = await getBoardById(area.boardId);
  if (!board || !(await canAccessBoard(user, board))) return [];
  const [status] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, area.sourceStatusId), eq(boardStatuses.boardId, area.boardId)))
    .limit(1);
  if (!status) return [];

  const rows = await db
    .select({
      id: cards.id,
      number: cards.number,
      title: cards.title,
      applicant: cards.applicant,
      amount: cards.requestedAmount,
      priority: priorities.label,
    })
    .from(cards)
    .leftJoin(priorities, eq(priorities.id, cards.priorityId))
    .where(and(eq(cards.boardId, area.boardId), eq(cards.statusId, area.sourceStatusId)))
    .orderBy(asc(cards.position), asc(cards.id));
  if (!rows.length) return [];
  const assignments = await db
    .select({ cardId: protocolCardLinks.cardId, folderName: protocolSessions.folderName })
    .from(protocolCardLinks)
    .innerJoin(protocolSessions, eq(protocolSessions.id, protocolCardLinks.sessionId))
    .where(
      and(
        eq(protocolSessions.areaId, area.id),
        inArray(protocolCardLinks.cardId, rows.map((r) => r.id)),
      ),
    );
  const assigned = new Map(assignments.map((a) => [a.cardId, a.folderName]));
  return sortProtocolSuggestions(
    rows.map((row) => ({ ...row, assignedSession: assigned.get(row.id) ?? null })),
  );
}

/** Synchronisiert Markdown-Marker und n:m-Relationen; verändert nie Kartenstatus/-position. */
export async function reconcileProtocolCardLinks(
  area: ProtocolArea,
  session: ProtocolSession,
  links: { cardId: number; top: string }[],
  replannedCardIds: number[] = [],
): Promise<{ conflicts: number }> {
  if (!area.boardId) {
    if (links.length) throw new Error("Für diesen Protokollbereich ist kein Finanzboard konfiguriert.");
    await db.delete(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
    return { conflicts: 0 };
  }
  const ids = [...new Set(links.map((link) => link.cardId))];
  if (!Array.isArray(replannedCardIds) || replannedCardIds.some(id => !Number.isSafeInteger(id) || !ids.includes(id))) throw new Error("Ungültige neu eingeplante Finanzanträge.");
  const replanned = new Set(replannedCardIds);
  const validCards = ids.length
    ? await db.select({ id: cards.id }).from(cards).where(and(eq(cards.boardId, area.boardId), inArray(cards.id, ids)))
    : [];
  if (validCards.length !== ids.length) throw new Error("Mindestens eine Finanzverknüpfung gehört nicht zum konfigurierten Board.");

  let conflicts = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
    const byCard = new Map(existing.map((link) => [link.cardId, link]));
    const removedIds = existing.filter((entry) => !ids.includes(entry.cardId)).map((entry) => entry.cardId);
    if (removedIds.length) {
      await tx.delete(protocolCardLinks).where(and(eq(protocolCardLinks.sessionId, session.id), inArray(protocolCardLinks.cardId, removedIds)));
      for (const removed of existing.filter((entry) => removedIds.includes(entry.cardId))) {
        if (!removed.lastAutoDecisionRef) continue;
        const [card] = await tx.select({ decisionRef: cards.decisionRef }).from(cards).where(eq(cards.id, removed.cardId)).limit(1);
        if (card?.decisionRef !== removed.lastAutoDecisionRef) continue;
        const [other] = await tx
          .select({ value: protocolCardLinks.lastAutoDecisionRef })
          .from(protocolCardLinks)
          .where(and(eq(protocolCardLinks.cardId, removed.cardId), ne(protocolCardLinks.sessionId, session.id)))
          .orderBy(desc(protocolCardLinks.updatedAt))
          .limit(1);
        await tx.update(cards).set({ decisionRef: other?.value ?? null, updatedAt: new Date() }).where(eq(cards.id, removed.cardId));
      }
    } else if (!ids.length) {
      await tx.delete(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
    }

    for (const link of links) {
      const autoRef = renderDecisionRef(
        area.decisionRefPattern,
        session.folderName,
        session.sessionDate,
        link.top,
      );
      const previous = byCard.get(link.cardId);
      const [card] = await tx.select({ decisionRef: cards.decisionRef }).from(cards).where(eq(cards.id, link.cardId)).limit(1);
      const autoRefs = await tx
        .select({ value: protocolCardLinks.lastAutoDecisionRef })
        .from(protocolCardLinks)
        .where(eq(protocolCardLinks.cardId, link.cardId));
      // A new/changed TOP is an explicit assignment, even after manual edits.
      // Unchanged TOPs still allow subsequent manual reference adjustments.
      const newlyScheduled = !previous || previous.top !== link.top || previous.lastAutoDecisionRef !== autoRef || replanned.has(link.cardId);
      const mayUpdate = newlyScheduled || mayReplaceDecisionRef(card.decisionRef, [
        previous?.lastAutoDecisionRef,
        ...autoRefs.map((item) => item.value),
      ]);
      if (mayUpdate) {
        await tx.update(cards).set({ decisionRef: autoRef, updatedAt: new Date() }).where(eq(cards.id, link.cardId));
      } else {
        conflicts += 1;
      }
      await tx
        .insert(protocolCardLinks)
        .values({
          sessionId: session.id,
          cardId: link.cardId,
          top: link.top,
          lastAutoDecisionRef: autoRef,
          decisionRefConflict: !mayUpdate,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [protocolCardLinks.sessionId, protocolCardLinks.cardId],
          set: {
            top: link.top,
            lastAutoDecisionRef: autoRef,
            decisionRefConflict: !mayUpdate,
            updatedAt: new Date(),
          },
        });
    }
  });
  return { conflicts };
}

/** Vor einem destruktiven Cloud-Zugriff auch die tatsächlich betroffenen Boards prüfen. */
export async function assertProtocolDeletionBoardAccess(user: User, session: ProtocolSession): Promise<void> {
  const linkedBoards = await db
    .selectDistinct({ boardId: cards.boardId })
    .from(protocolCardLinks)
    .innerJoin(cards, eq(cards.id, protocolCardLinks.cardId))
    .where(eq(protocolCardLinks.sessionId, session.id));
  for (const { boardId } of linkedBoards) {
    const board = await getBoardById(boardId);
    if (!board || !(await canAccessBoard(user, board))) {
      throw new Error("Zum Löschen dieses Protokolls oder dieser Sitzung ist auch Zugriff auf alle verknüpften Antragsboards erforderlich.");
    }
  }
}

/** Erst nach bestätigtem Cloud-DELETE: Relationen, automatische Referenzen und Metadaten atomar bereinigen. */
export async function cleanupDeletedProtocolResource(
  user: User,
  session: ProtocolSession,
  mode: "session" | "protocol",
): Promise<number[]> {
  await assertProtocolDeletionBoardAccess(user, session);
  return db.transaction(async (tx) => {
    await tx.select({ id: protocolSessions.id }).from(protocolSessions)
      .where(and(eq(protocolSessions.id, session.id), eq(protocolSessions.areaId, session.areaId)))
      .for("update");
    const links = await tx.select().from(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
    await tx.delete(protocolCardLinks).where(eq(protocolCardLinks.sessionId, session.id));
    for (const link of links) {
      if (!link.lastAutoDecisionRef) continue;
      const [fallback] = await tx
        .select({ value: protocolCardLinks.lastAutoDecisionRef })
        .from(protocolCardLinks)
        .where(and(
          eq(protocolCardLinks.cardId, link.cardId),
          isNotNull(protocolCardLinks.lastAutoDecisionRef),
          eq(protocolCardLinks.decisionRefConflict, false),
        ))
        .orderBy(desc(protocolCardLinks.updatedAt), desc(protocolCardLinks.id))
        .limit(1);
      // Vergleich im UPDATE selbst: auch eine gleichzeitig manuell geänderte
      // Beschlussreferenz darf durch die Löschbereinigung nicht verloren gehen.
      await tx.update(cards).set({ decisionRef: fallback?.value ?? null, updatedAt: new Date() })
        .where(and(eq(cards.id, link.cardId), eq(cards.decisionRef, link.lastAutoDecisionRef)));
    }
    if (mode === "session") {
      await tx.delete(protocolSessions)
        .where(and(eq(protocolSessions.id, session.id), eq(protocolSessions.areaId, session.areaId)));
    } else {
      await tx.update(protocolSessions).set({
        protocolPath: null,
        protocolFileId: null,
        protocolEtag: null,
        protocolLastModified: null,
        lastSyncedAt: new Date(),
      }).where(and(eq(protocolSessions.id, session.id), eq(protocolSessions.areaId, session.areaId)));
    }
    return links.map((link) => link.cardId);
  });
}
