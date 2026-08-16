// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, boards, boardStatuses, cards } from "@/lib/db/schema";
import {
  ATTACHMENT_KIND_LABELS,
  PUBLIC_ATTACHMENT_KINDS,
} from "@/lib/constants";
import { dbErrorWithoutParams } from "@/lib/db-errors";
import { isFeedbackToken } from "@/lib/public-feedback-submission";

/**
 * Gemeinsame LESENDE Sicht auf den öffentlichen Antragsstatus — genutzt von
 *   1. der Webansicht `/status/{token}`
 *   2. dem öffentlichen API-Endpunkt `POST /api/public/v1/status`
 *
 * Der Zweck ist, dass Webansicht und API nicht auseinanderlaufen können: Was
 * hier nicht drinsteht, sieht auch niemand. Insbesondere die Sichtbarkeit der
 * Anhänge und die Berechnung der verfügbaren Aktionen liegen genau EINMAL vor.
 *
 * Für Feedback gibt es die entsprechende Funktion `getFeedbackByToken()` in
 * `lib/public-feedback-submission.ts` (Snapshot-basiert).
 */

/**
 * Öffentlich sichtbare benannte Slots in fester Anzeige-Reihenfolge. Die
 * Beschriftung kommt aus `ATTACHMENT_KIND_LABELS` — dieselbe Quelle wie die
 * Board-Einstellungen, damit beide nicht auseinanderlaufen.
 *
 * Der Studierendenausweis fehlt hier bewusst: Er ist rein intern und darf
 * öffentlich weder auftauchen noch abrufbar sein.
 */
const NAMED_PUBLIC_KINDS = (
  ["finance_request", "annex_a", "annex_b"] as const
).map((kind) => ({ kind, label: ATTACHMENT_KIND_LABELS[kind] }));

/**
 * Liegt die Karte zu diesem Token auf einem Leih-System-Board?
 *
 * Jede Karte braucht laut Schema einen Token (`cards.token` ist NOT NULL
 * UNIQUE), also bekommt auch die Tracking-Karte eines Leihvorgangs einen —
 * obwohl sie keinen braucht: Der öffentliche Ausleih-Status hängt an einem
 * EIGENEN Token an der Vorgangszeile (`inventory_loans.token`,
 * `/inventar/status/{token}`) und ist von dieser Sperre nicht betroffen.
 *
 * Ohne die Sperre lieferte `/status/{Karten-Token}` für eine Leihkarte eine
 * vollwertige ANTRAGS-Statusseite samt Gegenstandsname, Entleihername und
 * offenem PDF-Upload — ein Ausgabeweg, den es laut Codekommentar in
 * `maybeCreateTrackingCard` („wird nicht veröffentlicht") gar nicht geben soll.
 */
async function isLoanTrackingToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const [row] = await db
      .select({ inventoryBoardId: boards.inventoryBoardId })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(cards.token, token))
      .limit(1);
    return row?.inventoryBoardId != null;
  } catch (e) {
    // Token ist Query-Parameter → nie im Fehlertext weiterreichen (Logs).
    throw dbErrorWithoutParams(e, "loan-tracking-token-check");
  }
}

/**
 * Ist dieser Token ein ANTRAGS-Token? Feedback- und Leih-Tracking-Karten sind
 * ganz normale Karten auf einem echten Board — ohne diese Prüfung könnte ein
 * Gremiumsmitglied dort intern eine PDF anhängen, und der Einreicher lüde sie
 * über seinen Feedback-Token herunter, obwohl die Feedback-Statusseite bewusst
 * gar keine Dokumentenliste zeigt.
 *
 * Für die schreibenden bzw. dateiliefernden Antrags-Einstiege, die die Karte
 * selbst nachschlagen: Anhang-Route, PDF-Route und die beiden Server Actions.
 * Die Statusseite hat ihre eigene Sperre (`getApplicationStatusByToken`) — nur
 * ein Einstieg ohne Sperre reicht, um die Trennung auszuhebeln. Gibt `null`
 * zurück, wenn der Token unbekannt ist ODER zu einem Feedback bzw. einem
 * Leihvorgang gehört; die Aufrufer machen daraus dieselbe generische „nicht
 * gefunden"-Antwort.
 */
export async function resolveApplicationCardId(
  token: string,
): Promise<number | null> {
  if (!token) return null;
  let row: { id: number; inventoryBoardId: number | null } | undefined;
  try {
    // `cards.board_id` ist NOT NULL mit FK auf boards — der INNER JOIN verliert
    // also keine Zeile und liefert die System-Board-Kennung gleich mit.
    [row] = await db
      .select({ id: cards.id, inventoryBoardId: boards.inventoryBoardId })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(cards.token, token))
      .limit(1);
  } catch (e) {
    // Drizzle-Fehlertexte enthalten die Query-Parameter — hier den geheimen
    // Status-Token, der nie in Logs landen darf. Param-frei weiterwerfen.
    throw dbErrorWithoutParams(e, "status-loader");
  }
  if (!row) return null;
  // Leih-Tracking-Karte: eigener Status-Weg (/inventar/status/{token}).
  if (row.inventoryBoardId != null) return null;
  if (await isFeedbackToken(token)) return null;
  return row.id;
}

/**
 * Darf für diesen Token ein Live-Stream (SSE) laufen?
 *
 * Der Stream unter `/api/status/{token}/stream` bedient BEIDE öffentlichen
 * Kartenseiten (Antrag und Feedback) — Feedback-Tokens dürfen hier deshalb
 * nicht mitgesperrt werden, Leih-Tracking-Karten schon: Für sie gibt es keine
 * öffentliche Kartenseite mehr, ein Änderungs-Ticker wäre nur ein Restsignal.
 */
export async function isPublicCardStreamToken(token: string): Promise<boolean> {
  return !(await isLoanTrackingToken(token));
}

export type PublicDocument = {
  id: number;
  kind: string;
  /** Anzeigename des Slots; bei nachgereichten Dateien der Dateiname. */
  label: string;
  filename: string;
  mime: string;
};

/**
 * Welchen „Einreichen"-Knopf zeigt die Webansicht gerade?
 *   resubmission = Nachreichung, receipt = Quittung, null = keinen.
 */
export type SubmitMode = "resubmission" | "receipt" | null;

export type PublicApplicationStatus = {
  token: string;
  number: string | null;
  title: string;
  applicant: string | null;
  statusName: string | null;
  createdAt: Date;
  updatedAt: Date;
  resubmittedAt: Date | null;
  applicantNote: string | null;
  /** Antrag liegt in der Archiv-Trigger-Spalte → öffentlich abgeschlossen. */
  archived: boolean;
  /** Dürfen öffentlich weitere Dateien hinzugefügt werden? */
  canUploadDocuments: boolean;
  submitMode: SubmitMode;
  documents: PublicDocument[];
};

/**
 * Lädt den öffentlichen Antragsstatus zu einem Token.
 *
 * Gibt `undefined` zurück, wenn es den Token nicht gibt ODER er zu einem
 * FEEDBACK gehört — Feedback hat eine eigene Statusseite und darf hier nicht
 * als Antrag erscheinen. Beide Fälle sind bewusst nicht unterscheidbar.
 */
export async function getApplicationStatusByToken(
  token: string,
): Promise<PublicApplicationStatus | undefined> {
  if (!token) return undefined;

  let row;
  try {
    [row] = await db
      .select({
        id: cards.id,
        boardId: cards.boardId,
        statusId: cards.statusId,
        number: cards.number,
        title: cards.title,
        applicant: cards.applicant,
        createdAt: cards.createdAt,
        updatedAt: cards.updatedAt,
        resubmittedAt: cards.resubmittedAt,
        applicantNote: cards.applicantNote,
        statusName: boardStatuses.name,
        isArchiveTrigger: boardStatuses.isArchiveTrigger,
      })
      .from(cards)
      .leftJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
      .where(eq(cards.token, token))
      .limit(1);
  } catch (e) {
    // Token ist Query-Parameter → nie im Fehlertext weiterreichen (Logs).
    throw dbErrorWithoutParams(e, "status-loader");
  }
  if (!row) return undefined;
  if (await isFeedbackToken(token)) return undefined;

  // Board-Gates: bestimmen, ob/welcher „Einreichen"-Knopf erscheint.
  const [board] = await db
    .select({
      resubmitStatusId: boards.resubmitStatusId,
      receiptFromStatusId: boards.receiptFromStatusId,
      receiptToStatusId: boards.receiptToStatusId,
      inventoryBoardId: boards.inventoryBoardId,
    })
    .from(boards)
    .where(eq(boards.id, row.boardId))
    .limit(1);
  // Leih-Tracking-Karte: kein Antrag, sondern ein Leihvorgang mit eigenem
  // öffentlichen Weg (/inventar/status/{token}). Wie ein unbekannter Token
  // behandeln — von außen nicht unterscheidbar.
  if (board?.inventoryBoardId != null) return undefined;

  // Liegt der Antrag in der Archiv-Spalte (Nextcloud-Trigger), ist er
  // abgeschlossen: kein öffentliches Nachreichen / Einreichen mehr.
  const archived = !!row.isArchiveTrigger;
  const canResubmit =
    !archived &&
    !!board?.resubmitStatusId &&
    row.statusId === board.resubmitStatusId;
  const canReceipt =
    !archived &&
    !!board?.receiptFromStatusId &&
    !!board?.receiptToStatusId &&
    row.statusId === board.receiptFromStatusId;

  const atts = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.cardId, row.id),
        // Whitelist aus den Konstanten — der Studierendenausweis steht dort
        // bewusst NICHT drin und kann so nie öffentlich werden.
        inArray(attachments.kind, [...PUBLIC_ATTACHMENT_KINDS]),
      ),
    )
    .orderBy(asc(attachments.uploadedAt));

  const documents: PublicDocument[] = [];
  for (const n of NAMED_PUBLIC_KINDS) {
    const file = atts.find((a) => a.kind === n.kind);
    if (file) {
      documents.push({
        id: file.id,
        kind: file.kind,
        label: n.label,
        filename: file.filename,
        mime: file.mime,
      });
    }
  }
  // Nachgereichte Dateien haben keinen festen Slot-Namen — dort ist der
  // Dateiname zugleich das Label (wie in der Webansicht).
  for (const a of atts.filter((x) => x.kind === "other")) {
    documents.push({
      id: a.id,
      kind: a.kind,
      label: a.filename,
      filename: a.filename,
      mime: a.mime,
    });
  }

  return {
    token,
    number: row.number,
    title: row.title,
    applicant: row.applicant,
    statusName: row.statusName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resubmittedAt: row.resubmittedAt,
    applicantNote: row.applicantNote,
    archived,
    // Exakt die Bedingung der Webansicht: Uploads entfallen erst mit dem Archiv.
    canUploadDocuments: !archived,
    submitMode: canResubmit ? "resubmission" : canReceipt ? "receipt" : null,
    documents,
  };
}
