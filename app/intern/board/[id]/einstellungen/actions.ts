// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accounts,
  boardAccess,
  boardArchive,
  boardCardFields,
  boardNumbering,
  boards,
  boardStatuses,
  cards,
  groups,
  users,
} from "@/lib/db/schema";
import { requireBoardManage } from "@/lib/authz";
import { BoardDeleteBlockedError, deleteBoardCascade } from "@/lib/boards";
import {
  ARCHIVE_FOLDER_FIELD_KEYS,
  CARD_FIELD_KEYS,
  DEFAULT_ARCHIVE_FOLDER_SEPARATOR,
} from "@/lib/constants";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { testConnection } from "@/lib/nextcloud";
import { isSafeExternalUrl } from "@/lib/url-guard";

export type State = { error?: string; success?: string };

function rev(boardId: number) {
  revalidatePath(`/intern/board/${boardId}/einstellungen`);
  revalidatePath(`/intern/board/${boardId}`);
}

// --- Board umbenennen ---------------------------------------------------
const nameSchema = z.object({
  name: z.string().min(1, "Name erforderlich.").max(120),
  description: z.string().max(500).optional(),
});

export async function renameBoardAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const parsed = nameSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  await db
    .update(boards)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(boards.id, boardId));
  rev(boardId);
  return { success: "Gespeichert." };
}

// --- Stati --------------------------------------------------------------
export async function addStatusAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireBoardManage(boardId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const [row] = await db
    .select({ m: max(boardStatuses.position) })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId));
  const maxPos = row?.m ?? -1;
  await db.insert(boardStatuses).values({ boardId, name, position: maxPos + 1 });
  rev(boardId);
}

export async function renameStatusAction(
  boardId: number,
  statusId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name erforderlich." };
  await db
    .update(boardStatuses)
    .set({ name })
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)));
  rev(boardId);
  return { success: "Gespeichert." };
}

export async function moveStatusAction(
  boardId: number,
  statusId: number,
  dir: "up" | "down",
): Promise<void> {
  await requireBoardManage(boardId);
  const list = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position));
  const idx = list.findIndex((s) => s.id === statusId);
  if (idx === -1) return;
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  const a = list[idx];
  const b = list[swapIdx];
  await db.transaction(async (tx) => {
    await tx
      .update(boardStatuses)
      .set({ position: b.position })
      .where(eq(boardStatuses.id, a.id));
    await tx
      .update(boardStatuses)
      .set({ position: a.position })
      .where(eq(boardStatuses.id, b.id));
  });
  rev(boardId);
}

/** Komplette neue Reihenfolge der Spalten setzen (Drag&Drop). */
export async function reorderStatusesAction(
  boardId: number,
  orderedIds: number[],
): Promise<void> {
  await requireBoardManage(boardId);
  const rows = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId));
  const valid = new Set(rows.map((r) => r.id));
  const ordered = orderedIds.filter((id) => valid.has(id));
  for (const r of rows) if (!ordered.includes(r.id)) ordered.push(r.id);
  await db.transaction(async (tx) => {
    for (let i = 0; i < ordered.length; i++) {
      await tx
        .update(boardStatuses)
        .set({ position: i })
        .where(
          and(eq(boardStatuses.id, ordered[i]), eq(boardStatuses.boardId, boardId)),
        );
    }
  });
  rev(boardId);
}

export async function deleteStatusAction(
  boardId: number,
  statusId: number,
): Promise<State> {
  await requireBoardManage(boardId);
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId));
  if (Number(row?.c ?? 0) <= 1) {
    return { error: "Das Board braucht mindestens eine Spalte." };
  }
  try {
    await db
      .delete(boardStatuses)
      .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)));
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    // 23503 = foreign_key_violation (Karten, Standort oder Feedback-Bereich
    // referenzieren die Spalte).
    if (code === "23503") {
      return {
        error:
          "Spalte enthält Karten oder ist Ziel eines Standorts bzw. eines Feedback-Bereichs. Bitte zuerst leeren bzw. Routing umstellen.",
      };
    }
    throw err;
  }
  rev(boardId);
  return { success: "Spalte gelöscht." };
}

export async function setArchiveTriggerAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  // Bis zu zwei Auslöse-Spalten (optional). Leere/ungültige werden ignoriert,
  // Duplikate entfernt.
  const ids = [...new Set(
    ["statusId", "statusId2"]
      .map((k) => Number(formData.get(k)))
      .filter((n) => Number.isInteger(n) && n > 0),
  )].slice(0, 2);
  await db.transaction(async (tx) => {
    await tx
      .update(boardStatuses)
      .set({ isArchiveTrigger: false })
      .where(eq(boardStatuses.boardId, boardId));
    if (ids.length) {
      await tx
        .update(boardStatuses)
        .set({ isArchiveTrigger: true })
        .where(
          and(
            eq(boardStatuses.boardId, boardId),
            inArray(boardStatuses.id, ids),
          ),
        );
    }
  });
  rev(boardId);
  return { success: "Archiv-Trigger gespeichert." };
}

export async function setInstructionTriggerAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const raw = formData.get("statusId");
  const statusId = raw ? Number(raw) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(boardStatuses)
      .set({ isInstructionTrigger: false })
      .where(eq(boardStatuses.boardId, boardId));
    if (statusId) {
      await tx
        .update(boardStatuses)
        .set({ isInstructionTrigger: true })
        .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)));
    }
  });
  rev(boardId);
  return { success: "Anweisungsdatum-Trigger gespeichert." };
}

export async function setTransferTriggerAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const raw = formData.get("statusId");
  const statusId = raw ? Number(raw) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(boardStatuses)
      .set({ isTransferTrigger: false })
      .where(eq(boardStatuses.boardId, boardId));
    if (statusId) {
      await tx
        .update(boardStatuses)
        .set({ isTransferTrigger: true })
        .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)));
    }
  });
  rev(boardId);
  return { success: "Überweisungsdatum-Trigger gespeichert." };
}

// --- Öffentliches Einreichen (Gates) -----------------------------------
/** Prüft, ob die Status-ID zum Board gehört; sonst null. */
async function validBoardStatus(
  boardId: number,
  raw: FormDataEntryValue | null,
): Promise<number | null> {
  const statusId = raw ? Number(raw) : null;
  if (!statusId || !Number.isInteger(statusId)) return null;
  const [s] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(and(eq(boardStatuses.id, statusId), eq(boardStatuses.boardId, boardId)))
    .limit(1);
  return s ? statusId : null;
}

/** Gate 1 „Nachreichung": Spalte, ab der öffentlich eingereicht werden kann. */
export async function setResubmitStatusAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const id = await validBoardStatus(boardId, formData.get("statusId"));
  await db.update(boards).set({ resubmitStatusId: id }).where(eq(boards.id, boardId));
  rev(boardId);
  return { success: "Gespeichert." };
}

/** Gate 2 „Quittung": Spalte, ab der öffentlich eingereicht werden kann. */
export async function setReceiptFromStatusAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const id = await validBoardStatus(boardId, formData.get("statusId"));
  await db
    .update(boards)
    .set({ receiptFromStatusId: id })
    .where(eq(boards.id, boardId));
  rev(boardId);
  return { success: "Gespeichert." };
}

/** Gate 2 „Quittung": Zielspalte, in die die Karte nach Einreichen springt. */
export async function setReceiptToStatusAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const id = await validBoardStatus(boardId, formData.get("statusId"));
  await db
    .update(boards)
    .set({ receiptToStatusId: id })
    .where(eq(boards.id, boardId));
  rev(boardId);
  return { success: "Gespeichert." };
}

// --- Done-Spalte (Erledigt-Archiv) -------------------------------------
export async function setDoneColumnAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const enabled = formData.get("enabled") === "on";

  if (!enabled) {
    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ doneStatusId: null, doneSweepTime: null })
        .where(eq(boards.id, boardId));
      await tx
        .update(cards)
        .set({ doneSince: null })
        .where(eq(cards.boardId, boardId));
    });
    rev(boardId);
    return { success: "Done-Spalte deaktiviert." };
  }

  const statusId = await validBoardStatus(boardId, formData.get("statusId"));
  if (!statusId) return { error: "Bitte eine gültige Spalte als Done-Spalte wählen." };

  const timeRaw = String(formData.get("time") ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeRaw);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) {
    return { error: "Bitte eine gültige Uhrzeit (HH:MM) angeben." };
  }
  const time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({ doneStatusId: statusId, doneSweepTime: time })
      .where(eq(boards.id, boardId));
    // Karten in der Done-Spalte (ohne done_since) bekommen ihren Startzeitpunkt;
    // Karten außerhalb verlieren ihn.
    await tx
      .update(cards)
      .set({ doneSince: new Date() })
      .where(
        and(
          eq(cards.boardId, boardId),
          eq(cards.statusId, statusId),
          isNull(cards.doneSince),
          isNull(cards.archivedAt),
        ),
      );
    await tx
      .update(cards)
      .set({ doneSince: null })
      .where(and(eq(cards.boardId, boardId), ne(cards.statusId, statusId)));
  });
  rev(boardId);
  return { success: "Done-Spalte gespeichert." };
}

export async function setDefaultAccountAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const raw = formData.get("accountId");
  const accountId = raw ? Number(raw) : null;
  if (accountId != null) {
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    if (!acc) return { error: "Konto nicht gefunden." };
  }
  await db
    .update(boards)
    .set({ defaultAccountId: accountId })
    .where(eq(boards.id, boardId));
  rev(boardId);
  return { success: "Standardkonto gespeichert." };
}

// --- Freigaben ----------------------------------------------------------
export async function addAccessUserAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireBoardManage(boardId);
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return;
  const exists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!exists.length) return;
  await db.insert(boardAccess).values({ boardId, userId }).onConflictDoNothing();
  rev(boardId);
}

export async function addAccessGroupAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireBoardManage(boardId);
  const groupId = Number(formData.get("groupId"));
  if (!Number.isInteger(groupId)) return;
  const exists = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!exists.length) return;
  await db.insert(boardAccess).values({ boardId, groupId }).onConflictDoNothing();
  rev(boardId);
}

export async function removeAccessAction(
  boardId: number,
  accessId: number,
): Promise<void> {
  await requireBoardManage(boardId);
  await db
    .delete(boardAccess)
    .where(and(eq(boardAccess.id, accessId), eq(boardAccess.boardId, boardId)));
  rev(boardId);
}

// --- Kartenfelder -------------------------------------------------------
export async function setCardFieldsAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  // Reihenfolge der editierbaren Felder (CSV der field_keys); Anhang-Slots
  // werden danach einsortiert (ihre Reihenfolge ist nicht relevant).
  const order = String(formData.get("order") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const positionOf = (key: string) => {
    const i = order.indexOf(key);
    return i >= 0
      ? i
      : order.length + (CARD_FIELD_KEYS as readonly string[]).indexOf(key);
  };
  await db.transaction(async (tx) => {
    for (const key of CARD_FIELD_KEYS) {
      const visible = formData.get(`field_${key}`) === "on";
      const position = positionOf(key);
      await tx
        .insert(boardCardFields)
        .values({ boardId, fieldKey: key, visible, position })
        .onConflictDoUpdate({
          target: [boardCardFields.boardId, boardCardFields.fieldKey],
          set: { visible, position },
        });
    }
  });
  rev(boardId);
  return { success: "Kartenfelder gespeichert." };
}

// --- Antragsnummer ------------------------------------------------------
export async function setBoardNumberingAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const enabled = formData.get("enabled") === "on";
  const prefix = String(formData.get("prefix") ?? "").slice(0, 30);
  const year = String(formData.get("year") ?? "").slice(0, 20);
  const code = String(formData.get("code") ?? "").slice(0, 30);
  const separator = String(formData.get("separator") ?? "_").slice(0, 5);

  const padRaw = String(formData.get("padding") ?? "").trim();
  const padding = padRaw === "" ? 0 : Math.max(0, Math.min(10, Number(padRaw) || 0));

  const nextRaw = String(formData.get("next") ?? "").trim();
  // Obergrenze = int4-Maximum (Spalte ist integer) → kein Overflow-500.
  if (!/^\d+$/.test(nextRaw) || Number(nextRaw) > 2_147_483_647) {
    return {
      error: "Bitte eine gültige Startnummer angeben (ganze Zahl 0–2147483647).",
    };
  }
  const next = Number(nextRaw);

  await db
    .insert(boardNumbering)
    .values({ boardId, enabled, prefix, year, code, separator, padding, next })
    .onConflictDoUpdate({
      target: boardNumbering.boardId,
      set: { enabled, prefix, year, code, separator, padding, next },
    });
  rev(boardId);
  return { success: "Antragsnummer-Einstellungen gespeichert." };
}

// --- Eigentum & Löschen -------------------------------------------------
export async function transferOwnerAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireBoardManage(boardId);
  const newOwnerId = Number(formData.get("ownerId"));
  if (!Number.isInteger(newOwnerId)) return;
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, newOwnerId), eq(users.isActive, true)))
    .limit(1);
  if (!owner.length) return; // nur aktive Nutzer dürfen Eigentümer werden
  await db.update(boards).set({ ownerId: newOwnerId }).where(eq(boards.id, boardId));
  rev(boardId);
}

// --- Nextcloud-Archiv ---------------------------------------------------
export async function setArchiveConfigAction(
  boardId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const enabled = formData.get("enabled") === "on";
  const ncUrl = String(formData.get("ncUrl") ?? "").trim() || null;
  if (ncUrl && !isSafeExternalUrl(ncUrl)) {
    return {
      error:
        "Nextcloud-URL muss eine öffentliche http(s)-Adresse sein (keine internen/privaten Hosts).",
    };
  }
  const ncUsername = String(formData.get("ncUsername") ?? "").trim() || null;
  const targetFolder = String(formData.get("targetFolder") ?? "").trim() || null;
  const newPassword = String(formData.get("ncPassword") ?? "");

  const [existing] = await db
    .select()
    .from(boardArchive)
    .where(eq(boardArchive.boardId, boardId))
    .limit(1);
  const ncPasswordEnc = newPassword
    ? encryptSecret(newPassword)
    : (existing?.ncPasswordEnc ?? null);

  if (enabled && (!ncUrl || !ncUsername || !targetFolder || !ncPasswordEnc)) {
    return {
      error:
        "Zum Aktivieren bitte URL, Benutzer, Passwort und Zielordner angeben.",
    };
  }

  // Ordnername-Konfiguration: CSV der Felder in der gewählten Reihenfolge
  // (aus dem sortierbaren Feld) + Trennzeichen (leer → Leerzeichen).
  const allowed = new Set<string>(ARCHIVE_FOLDER_FIELD_KEYS);
  const seen = new Set<string>();
  const folderFieldKeys: string[] = [];
  for (const k of String(formData.get("folderFields") ?? "").split(",")) {
    const key = k.trim();
    if (allowed.has(key) && !seen.has(key)) {
      seen.add(key);
      folderFieldKeys.push(key);
    }
  }
  const folderFields = folderFieldKeys.length ? folderFieldKeys.join(",") : "title";
  let folderSeparator = String(formData.get("folderSeparator") ?? "").slice(0, 5);
  if (folderSeparator === "") folderSeparator = DEFAULT_ARCHIVE_FOLDER_SEPARATOR;

  await db
    .insert(boardArchive)
    .values({
      boardId,
      enabled,
      ncUrl,
      ncUsername,
      ncPasswordEnc,
      targetFolder,
      folderFields,
      folderSeparator,
    })
    .onConflictDoUpdate({
      target: boardArchive.boardId,
      set: {
        enabled,
        ncUrl,
        ncUsername,
        ncPasswordEnc,
        targetFolder,
        folderFields,
        folderSeparator,
      },
    });
  rev(boardId);
  return { success: "Archiv-Einstellungen gespeichert." };
}

export async function testArchiveAction(
  boardId: number,
  _prev: State,
  _formData: FormData,
): Promise<State> {
  await requireBoardManage(boardId);
  const [cfg] = await db
    .select()
    .from(boardArchive)
    .where(eq(boardArchive.boardId, boardId))
    .limit(1);
  if (!cfg?.ncUrl || !cfg.ncUsername || !cfg.ncPasswordEnc || !cfg.targetFolder) {
    return { error: "Bitte zuerst Verbindung speichern." };
  }
  // Entschlüsselung kann bei Key-Rotation/korruptem Chiffrat werfen — abfangen,
  // sonst 500 statt freundlicher Meldung.
  let password: string;
  try {
    password = decryptSecret(cfg.ncPasswordEnc);
  } catch {
    return {
      error:
        "Gespeichertes Passwort konnte nicht entschlüsselt werden. Bitte erneut setzen.",
    };
  }
  const res = await testConnection(
    { url: cfg.ncUrl, username: cfg.ncUsername, password },
    cfg.targetFolder,
  );
  return res.ok
    ? { success: "Verbindung OK — Zielordner erreichbar." }
    : { error: `Verbindung fehlgeschlagen: ${res.error}` };
}

export async function deleteBoardAction(
  boardId: number,
  _prev: State,
  _formData: FormData,
): Promise<State> {
  return deleteBoardConfirmedAction(boardId);
}

/** Wie deleteBoardAction, aber ohne Form-Argumente (für In-App-Bestätigung). */
export async function deleteBoardConfirmedAction(
  boardId: number,
): Promise<State> {
  await requireBoardManage(boardId);
  try {
    await deleteBoardCascade(boardId);
  } catch (err) {
    if (err instanceof BoardDeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }
  redirect("/intern");
}
