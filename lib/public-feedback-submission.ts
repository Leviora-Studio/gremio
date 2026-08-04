// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  boardStatuses,
  cardActivity,
  cards,
  feedbackAreas,
  feedbackSubmissions,
} from "@/lib/db/schema";
import { assignCardNumberTx } from "@/lib/numbering";
import { generateToken, isTokenConflict } from "@/lib/token";
import {
  FEEDBACK_MAX_LENGTH,
  SUBMITTER_NAME_MAX_LENGTH,
  FEEDBACK_TITLE_MAX_LENGTH,
  normalizeFeedbackText,
  deriveFeedbackTitle,
} from "@/lib/feedback-constants";
import type { Tx } from "@/lib/public-application-submission";

/**
 * Fachliche Einreichungslogik für öffentliches FEEDBACK — EINE Quelle für beide
 * Aufrufer:
 *   1. Server-Action des Formulars unter `/feedback`
 *   2. öffentlicher API-Handler (`app/api/public/v1/feedback`)
 *
 * Aufgebaut wie `lib/public-application-submission.ts` (Anträge) und bewusst
 * ebenso geschnitten: Rate-Limit, Honeypot, Zeitfalle, Redirect bzw.
 * JSON-Serialisierung bleiben beim Aufrufer; die fachlichen Regeln (Bereich,
 * Routing, Pflichtfelder, Titelbildung, Nummernvergabe) liegen hier und können
 * zwischen Formular und API nicht auseinanderlaufen.
 */

// Konstanten und reine Helfer liegen DB-frei in lib/feedback-constants.ts,
// damit Client-Komponenten sie importieren können. Für Server-Aufrufer hier
// weiterreichen, damit es eine erwartbare Importstelle gibt.
export {
  FEEDBACK_MAX_LENGTH,
  SUBMITTER_NAME_MAX_LENGTH,
  FEEDBACK_TITLE_MAX_LENGTH,
  normalizeFeedbackText,
  deriveFeedbackTitle,
};

const schema = z.object({
  areaId: z.coerce.number().int().positive("Bitte einen Bereich wählen."),
  submitterName: z
    .string()
    .trim()
    .min(1, "Bitte deinen Namen angeben.")
    .max(
      SUBMITTER_NAME_MAX_LENGTH,
      `Der Name darf höchstens ${SUBMITTER_NAME_MAX_LENGTH} Zeichen lang sein.`,
    ),
  feedback: z
    .string()
    .trim()
    .min(1, "Bitte Feedback eingeben.")
    .max(
      FEEDBACK_MAX_LENGTH,
      `Feedback darf höchstens ${FEEDBACK_MAX_LENGTH} Zeichen lang sein.`,
    ),
});

export type FieldIssue = { field: string; message: string };

export type FeedbackFailure = {
  ok: false;
  reason: "validation" | "area" | "internal";
  message: string;
  issues?: FieldIssue[];
};

export type FeedbackSuccess = {
  ok: true;
  token: string;
  number: string | null;
  cardId: number;
};

/** Vorzeitiger, gewollter Abbruch aus `preflightTx` (z. B. Idempotenz-Replay). */
export type FeedbackAborted<T> = { ok: false; reason: "aborted"; value: T };

export type FeedbackOptions<T> = {
  /** Text des Aktivitätseintrags (unterscheidet Formular und API). */
  activityDetail: string;
  /**
   * Läuft als ERSTES in der Transaktion, vor jedem Schreibzugriff. Gibt der
   * Aufrufer einen Wert zurück, wird abgebrochen und der Wert durchgereicht —
   * die Transaktion bleibt schreibfrei. Genutzt für Advisory-Lock + Lookup.
   */
  preflightTx?: (tx: Tx) => Promise<T | null>;
  /**
   * Läuft am ENDE derselben Transaktion, nachdem Karte, Snapshot, Aktivität und
   * Nummer geschrieben sind — für den Idempotenz-Datensatz.
   */
  withinTx?: (
    tx: Tx,
    ctx: { cardId: number; token: string; number: string | null },
  ) => Promise<void>;
};



/**
 * Validiert Felder und Bereich und legt bei Erfolg die Feedback-Karte an.
 *
 * Atomar: Karte, Snapshot (`feedback_submissions`), Aktivität, Kartennummer und
 * der optionale `withinTx`-Hook liegen in EINER Transaktion. Es kann also weder
 * eine Feedback-Karte ohne Snapshot noch ein Snapshot ohne Karte entstehen.
 */
export async function submitPublicFeedback<T = never>(
  raw: { areaId: unknown; submitterName: unknown; feedback: unknown },
  opts: FeedbackOptions<T>,
): Promise<FeedbackSuccess | FeedbackFailure | FeedbackAborted<T>> {
  // --- 1. Felder ----------------------------------------------------------
  const parsed = schema.safeParse({
    areaId: raw.areaId,
    submitterName: raw.submitterName,
    // Vor der Längenprüfung normalisieren, damit CRLF nicht doppelt zählt.
    feedback: normalizeFeedbackText(raw.feedback),
  });
  if (!parsed.success) {
    const issues: FieldIssue[] = parsed.error.issues.map((i) => ({
      field: String(i.path[0] ?? ""),
      message: i.message,
    }));
    return {
      ok: false,
      reason: "validation",
      message: issues[0]?.message ?? "Ungültige Eingabe.",
      issues,
    };
  }
  const feedbackText = normalizeFeedbackText(parsed.data.feedback);
  const submitterName = parsed.data.submitterName;

  // --- 2. Bereich + Routingziel -------------------------------------------
  const [area] = await db
    .select()
    .from(feedbackAreas)
    .where(eq(feedbackAreas.id, parsed.data.areaId))
    .limit(1);
  // Wie beim Standort-Routing: Die Zielspalte muss WIRKLICH zum Ziel-Board
  // gehören. Die beiden FKs sind einzeln gültig, auch wenn die Spalte zu einem
  // anderen Board zeigt — ohne diese Prüfung entstünde eine Karte, die auf
  // keinem Board auftaucht.
  const routedStatus =
    area?.targetBoardId && area?.targetStatusId
      ? (
          await db
            .select({ id: boardStatuses.id })
            .from(boardStatuses)
            .where(
              and(
                eq(boardStatuses.id, area.targetStatusId),
                eq(boardStatuses.boardId, area.targetBoardId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
  if (
    !area ||
    !area.enabled ||
    !area.targetBoardId ||
    !area.targetStatusId ||
    !routedStatus
  ) {
    return {
      ok: false,
      reason: "area",
      message: "Der gewählte Bereich ist nicht verfügbar.",
      issues: [
        { field: "areaId", message: "Der gewählte Bereich ist nicht verfügbar." },
      ],
    };
  }

  // --- 3. Zielposition ----------------------------------------------------
  const targetBoardId = area.targetBoardId;
  const targetStatusId = area.targetStatusId;
  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(eq(cards.boardId, targetBoardId), eq(cards.statusId, targetStatusId)),
    );
  const position = (maxRow?.m ?? -1) + 1;
  const title = deriveFeedbackTitle(feedbackText);

  // --- 4. Anlegen ---------------------------------------------------------
  let token = "";
  let cardId = 0;
  let assignedNumber: string | null = null;
  let aborted: { value: T } | null = null;

  try {
    for (let attempt = 0; ; attempt++) {
      token = generateToken();
      aborted = null;
      try {
        await db.transaction(async (tx) => {
          if (opts.preflightTx) {
            const early = await opts.preflightTx(tx);
            if (early != null) {
              aborted = { value: early };
              return; // schreibfreier Commit
            }
          }

          const [inserted] = await tx
            .insert(cards)
            .values({
              boardId: targetBoardId,
              statusId: targetStatusId,
              // Feedback kommt nicht aus dem Standort-Routing der Anträge.
              locationId: null,
              title,
              applicant: submitterName,
              // Der VOLLSTÄNDIGE Text — der Titel oben ist nur die Kurzfassung.
              notes: feedbackText,
              token,
              creatorUserId: null,
              accountId: null,
              position,
            })
            .returning();
          cardId = inserted.id;

          // Unveränderlicher Herkunfts-Snapshot, in DERSELBEN Transaktion.
          await tx.insert(feedbackSubmissions).values({
            cardId: inserted.id,
            areaId: area.id,
            areaName: area.name,
            submitterName,
            feedbackText,
          });

          await tx.insert(cardActivity).values({
            cardId: inserted.id,
            userId: null,
            type: "created",
            detail: opts.activityDetail,
          });

          assignedNumber = await assignCardNumberTx(
            tx,
            targetBoardId,
            inserted.id,
          );

          if (opts.withinTx) {
            await opts.withinTx(tx, {
              cardId: inserted.id,
              token,
              number: assignedNumber,
            });
          }
        });
        break;
      } catch (e) {
        // Nur bei Token-Duplikat neu würfeln; sonst weiterwerfen.
        if (isTokenConflict(e) && attempt < 5) continue;
        throw e;
      }
    }
  } catch {
    return {
      ok: false,
      reason: "internal",
      message:
        "Beim Einreichen ist ein Fehler aufgetreten. Bitte versuche es erneut.",
    };
  }

  if (aborted) {
    return { ok: false, reason: "aborted", value: (aborted as { value: T }).value };
  }
  return { ok: true, token, number: assignedNumber, cardId };
}

export type FeedbackView = {
  cardId: number;
  token: string;
  /** Board-Status der Karte (Live-Wert). */
  statusName: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Öffentlicher Hinweis des Gremiums (bewusst öffentlich, siehe Statusseite). */
  applicantNote: string | null;
  number: string | null;
  // --- Snapshot der ursprünglichen Einreichung (unveränderlich) -------------
  areaName: string;
  submitterName: string;
  feedbackText: string;
};

/**
 * Feedback-Vorgang zu einem öffentlichen Token.
 *
 * Der INNER JOIN auf `feedback_submissions` ist zugleich die Trennung zwischen
 * Antrags- und Feedback-Statusseite: Ein Antrags-Token liefert hier nichts, ein
 * Feedback-Token umgekehrt nichts auf `/status/{token}`.
 *
 * Bereich, Name und Text kommen aus dem SNAPSHOT — nicht aus der Karte. Ändert
 * das Gremium intern `cards.applicant`/`cards.notes`, bleibt die öffentliche
 * Ansicht damit das, was ursprünglich eingereicht wurde.
 */
export async function getFeedbackByToken(
  token: string,
): Promise<FeedbackView | undefined> {
  if (!token) return undefined;
  const [row] = await db
    .select({
      cardId: cards.id,
      token: cards.token,
      statusName: boardStatuses.name,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      applicantNote: cards.applicantNote,
      number: cards.number,
      areaName: feedbackSubmissions.areaName,
      submitterName: feedbackSubmissions.submitterName,
      feedbackText: feedbackSubmissions.feedbackText,
    })
    .from(feedbackSubmissions)
    .innerJoin(cards, eq(cards.id, feedbackSubmissions.cardId))
    .leftJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(eq(cards.token, token))
    .limit(1);
  return row?.token ? { ...row, token: row.token } : undefined;
}

/**
 * Ist die Karte zu diesem Token eine Feedback-Karte? Genutzt, um sie auf den
 * ANTRAGS-Routen (`/status/{token}` und deren PDF) mit 404 abzuweisen.
 */
export async function isFeedbackToken(token: string): Promise<boolean> {
  if (!token) return false;
  const [row] = await db
    .select({ id: feedbackSubmissions.id })
    .from(feedbackSubmissions)
    .innerJoin(cards, eq(cards.id, feedbackSubmissions.cardId))
    .where(eq(cards.token, token))
    .limit(1);
  return !!row;
}

/** Herkunfts-Snapshot einer Karte — für die interne Detailansicht. */
export async function getFeedbackByCardId(
  cardId: number,
): Promise<{ areaName: string; submitterName: string } | undefined> {
  const [row] = await db
    .select({
      areaName: feedbackSubmissions.areaName,
      submitterName: feedbackSubmissions.submitterName,
    })
    .from(feedbackSubmissions)
    .where(eq(feedbackSubmissions.cardId, cardId))
    .limit(1);
  return row;
}

/** Öffentlich auswählbare Bereiche: aktiviert UND vollständig/korrekt geroutet. */
export async function listPublicFeedbackAreas(): Promise<
  { id: number; name: string }[]
> {
  return db
    .select({ id: feedbackAreas.id, name: feedbackAreas.name })
    .from(feedbackAreas)
    // INNER JOIN auf die Zielspalte MIT Board-Bedingung: schließt Bereiche aus,
    // deren Spalte zu einem anderen Board gehört (siehe oben).
    .innerJoin(
      boardStatuses,
      and(
        eq(boardStatuses.id, feedbackAreas.targetStatusId),
        eq(boardStatuses.boardId, feedbackAreas.targetBoardId),
      ),
    )
    .where(eq(feedbackAreas.enabled, true))
    .orderBy(feedbackAreas.position, feedbackAreas.id);
}
