// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  attachments,
  boards,
  boardStatuses,
  cardActivity,
  cards,
  locations,
} from "@/lib/db/schema";
import {
  AUSWEIS_MIME,
  MAX_UPLOAD_BYTES,
  PDF_MIME,
  type AttachmentKind,
} from "@/lib/constants";
import {
  deleteStoredFile,
  resolveMime,
  saveAntragBuffer,
  slotFileName,
  validateUpload,
} from "@/lib/attachments";
import { sanitizeSingleLine } from "@/lib/text";
import { assignCardNumberTx } from "@/lib/numbering";
import { generateToken, isTokenConflict } from "@/lib/token";

/**
 * Fachliche Einreichungslogik für öffentliche Anträge — EINE Quelle für beide
 * Aufrufer:
 *   1. Server-Action des Browserformulars (`app/actions.ts`)
 *   2. öffentlicher API-Handler (`app/api/public/v1/applications`)
 *
 * Bewusst NICHT enthalten (bleibt beim jeweiligen Aufrufer): Rate-Limit,
 * Honeypot, signierte Zeitfalle, Redirect bzw. JSON-Serialisierung. Diese
 * Schutzmaßnahmen sind formular- bzw. transportspezifisch; die fachlichen
 * Regeln (Standort-Routing, Pflichtfelder, Dateitypen/-größen, Nummernvergabe,
 * Anhänge) sind es nicht und dürfen zwischen Formular und API nie auseinander-
 * laufen.
 */

// Drizzle-Transaktionshandle (für Hooks, die in der Transaktion mitlaufen).
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Titel und Antragsteller werden VOR der Prüfung einzeilig bereinigt: NUL
// lehnt PostgreSQL ab, TAB und CR sprengen den WinAnsi-Encoder der PDF-
// Eingangsbestätigung. Die öffentliche API reicht sonst Rohstrings durch —
// Zod prüft nur die Länge.
const schema = z.object({
  locationId: z.coerce.number().int().positive("Bitte einen Standort wählen."),
  title: z
    .preprocess(sanitizeSingleLine, z.string())
    .pipe(z.string().min(1, "Bitte einen Antragsgegenstand angeben.").max(200)),
  applicant: z
    .preprocess(sanitizeSingleLine, z.string())
    .pipe(z.string().min(1, "Bitte den Antragsteller angeben.").max(200)),
});

/** Die vier Datei-Slots des öffentlichen Formulars, in fester Reihenfolge. */
export const APPLICATION_FILE_SLOTS = [
  { field: "finance_request", kind: "finance_request", allowed: PDF_MIME, required: true },
  { field: "student_card", kind: "student_card", allowed: AUSWEIS_MIME, required: true },
  { field: "annex_a", kind: "annex_a", allowed: PDF_MIME, required: false },
  { field: "annex_b", kind: "annex_b", allowed: PDF_MIME, required: false },
] as const satisfies readonly {
  field: string;
  kind: AttachmentKind;
  allowed: string[];
  required: boolean;
}[];

/** Eine bereits EINMAL gelesene Datei — Validierung, Hashing und Speicherung
 *  arbeiten auf denselben Bytes (kein mehrfaches Einlesen großer Uploads). */
export type PreparedUpload = {
  kind: AttachmentKind;
  field: string;
  /** Originalname des Uploads (der Anzeigename entsteht erst via slotFileName). */
  originalName: string;
  mime: string;
  size: number;
  bytes: Buffer;
  /**
   * SHA-256 des Inhalts, berechnet beim Einlesen — also VOR der Transaktion.
   * Der Idempotenz-Fingerprint der API braucht ihn; würde er erst in
   * `preflightTx` gebildet, liefe das Hashen von bis zu vier Uploads innerhalb
   * der offenen Transaktion und unter dem Advisory-Lock des Idempotenz-Keys.
   * Bei großen Anhängen hielte jeder Request die Sperre entsprechend lange.
   */
  sha256: string;
};

export type FieldIssue = { field: string; message: string };

export type SubmissionFailure = {
  ok: false;
  /**
   * Grobklasse für das Mapping auf HTTP-Status bzw. Formular-Meldungen.
   * `file_too_large` ist bewusst eigenständig, damit die API daraus 413 machen
   * kann, ohne die Größengrenze ein zweites Mal zu kennen.
   */
  reason: "validation" | "location" | "file" | "file_too_large" | "internal";
  message: string;
  issues?: FieldIssue[];
};

export type SubmissionSuccess = {
  ok: true;
  token: string;
  number: string | null;
  cardId: number;
};

/** Vorzeitiger, gewollter Abbruch aus `preflightTx` (z. B. Idempotenz-Replay). */
export type SubmissionAborted<T> = { ok: false; reason: "aborted"; value: T };

/**
 * Die GEPRÜFTEN Textfelder, exakt so, wie sie in der Karte landen (bereinigt,
 * getrimmt, `locationId` als Zahl). Der Idempotenz-Fingerprint muss über diese
 * Werte laufen und nicht über die Rohdaten: Sonst ergeben zwei Requests, die
 * dieselbe Karte erzeugen (etwa mit zusätzlichem Leerzeichen oder Tabulator im
 * Titel), verschiedene Fingerprints — der Retry eines Clients wäre dann ein
 * 409 statt eines Replays.
 */
export type ValidatedApplicationFields = {
  locationId: number;
  title: string;
  applicant: string;
};

export type SubmissionOptions<T> = {
  /** Text des Aktivitätseintrags (unterscheidet Formular und API). */
  activityDetail: string;
  /**
   * Läuft als ERSTES in der Transaktion, bevor irgendetwas geschrieben wird.
   * Gibt der Aufrufer einen Wert zurück, wird die Einreichung abgebrochen und
   * der Wert durchgereicht (`reason: "aborted"`) — die Transaktion bleibt dabei
   * schreibfrei. Genutzt für Advisory-Lock + Idempotenz-Lookup.
   */
  preflightTx?: (
    tx: Tx,
    prepared: PreparedUpload[],
    validated: ValidatedApplicationFields,
  ) => Promise<T | null>;
  /**
   * Läuft am ENDE derselben Transaktion, nachdem Karte, Aktivität, Nummer und
   * Anhänge geschrieben sind. Genutzt, um den Idempotenz-Datensatz atomar mit
   * der Karte anzulegen.
   */
  withinTx?: (
    tx: Tx,
    ctx: { cardId: number; token: string; number: string | null },
  ) => Promise<void>;
};

/**
 * Öffentlich auswählbare Standorte: aktiviert UND vollständig/korrekt geroutet.
 *
 * EINE Quelle für das Browserformular (`app/page.tsx`) und die öffentliche API
 * (`GET /api/public/v1/locations`) — Gegenstück zu `listPublicFeedbackAreas`.
 * Das Formular filterte vorher nur auf `enabled` und bot damit auch Standorte
 * an, deren Ziel-Spalte gar nicht (mehr) zum Ziel-Board gehört: Die Auswahl
 * erschien, die Einreichung scheiterte danach mit „Der gewählte Standort ist
 * nicht verfügbar." — inklusive Verlust der bereits ausgewählten Dateien.
 *
 * Der INNER JOIN mit Board-Bedingung ist exakt dieselbe Prüfung, die
 * `submitPublicApplication` beim Einreichen anwendet.
 *
 * Zusätzlich fallen Leih-System-Boards heraus (`boards.inventory_board_id`).
 * Sie tragen ausschließlich die Tracking-Karten der Leihvorgänge, und
 * `getApplicationStatusByToken` weist Karten von dort mit 404 ab — ein dorthin
 * gerouteter Antrag bekäme also einen Status-Link, der sofort ins Leere führt.
 * Die REST-API lehnt das Anlegen von Karten auf solchen Boards aus demselben
 * Grund mit 409 ab.
 */
export async function listPublicLocations(): Promise<
  { id: number; name: string }[]
> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .innerJoin(
      boardStatuses,
      and(
        eq(boardStatuses.id, locations.targetStatusId),
        eq(boardStatuses.boardId, locations.targetBoardId),
      ),
    )
    .innerJoin(boards, eq(boards.id, locations.targetBoardId))
    .where(and(eq(locations.enabled, true), isNull(boards.inventoryBoardId)))
    .orderBy(asc(locations.position), asc(locations.id));
}

function fileOrNull(v: unknown): File | null {
  return v instanceof File && v.size > 0 ? v : null;
}

/**
 * Validiert Felder, Standort und Dateien und legt bei Erfolg den Antrag an.
 *
 * Atomar: Karte, Aktivität, Antragsnummer, Anhänge (und der optionale
 * `withinTx`-Hook) liegen in EINER Transaktion. Rollt sie zurück, werden die
 * bereits geschriebenen Dateien wieder entfernt — es bleibt weder eine halbe
 * Karte noch eine Datei-Leiche zurück.
 */
export async function submitPublicApplication<T = never>(
  raw: {
    locationId: unknown;
    title: unknown;
    applicant: unknown;
    files: Record<string, unknown>;
  },
  opts: SubmissionOptions<T>,
): Promise<SubmissionSuccess | SubmissionFailure | SubmissionAborted<T>> {
  // --- 1. Textfelder -------------------------------------------------------
  const parsed = schema.safeParse({
    locationId: raw.locationId,
    title: raw.title,
    applicant: raw.applicant,
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

  // --- 2. Standort + Routingziel ------------------------------------------
  const [location] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, parsed.data.locationId))
    .limit(1);
  // Identische Bedingung wie die öffentliche Standortliste: aktiviert UND
  // vollständig geroutet. Sonst gäbe es kein Ziel für die Karte.
  //
  // Die Zielspalte muss zusätzlich WIRKLICH zum Ziel-Board gehören. Wird ein
  // Board umkonfiguriert, kann `target_status_id` auf eine fremde Spalte zeigen
  // (die FKs verhindern das nicht, sie sind einzeln gültig). Ohne diese Prüfung
  // entstünde eine Karte, die in einer Spalte eines anderen Boards hängt und auf
  // keinem Board auftaucht.
  //
  // Und das Ziel darf kein Leih-System-Board sein — identische Bedingung wie in
  // `listPublicLocations`, damit Auswahl und Einreichung nicht auseinanderlaufen
  // (Begründung dort).
  const routedStatus =
    location?.targetBoardId && location?.targetStatusId
      ? (
          await db
            .select({ id: boardStatuses.id })
            .from(boardStatuses)
            .innerJoin(boards, eq(boards.id, boardStatuses.boardId))
            .where(
              and(
                eq(boardStatuses.id, location.targetStatusId),
                eq(boardStatuses.boardId, location.targetBoardId),
                isNull(boards.inventoryBoardId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
  if (
    !location ||
    !location.enabled ||
    !location.targetBoardId ||
    !location.targetStatusId ||
    !routedStatus
  ) {
    return {
      ok: false,
      reason: "location",
      message: "Der gewählte Standort ist nicht verfügbar.",
      issues: [
        { field: "locationId", message: "Der gewählte Standort ist nicht verfügbar." },
      ],
    };
  }

  // --- 3. Dateien: Pflicht, Typ, Größe ------------------------------------
  const picked: { slot: (typeof APPLICATION_FILE_SLOTS)[number]; file: File }[] = [];
  for (const slot of APPLICATION_FILE_SLOTS) {
    const file = fileOrNull(raw.files[slot.field]);
    if (!file) {
      if (slot.required) {
        return {
          ok: false,
          reason: "validation",
          message:
            slot.kind === "finance_request"
              ? "Finanzantrag (PDF) ist erforderlich."
              : "Studierendenausweis ist erforderlich.",
          issues: [{ field: slot.field, message: "Diese Datei ist erforderlich." }],
        };
      }
      continue;
    }
    // Größe zuerst und separat: nur so kann die API daraus ein 413 machen,
    // ohne die Grenze selbst zu kennen. Die Meldung bleibt identisch zum
    // Formular, weil beide über validateUpload laufen.
    if (file.size > MAX_UPLOAD_BYTES) {
      const err = validateUpload(file, slot.allowed) ?? "Datei zu groß.";
      return {
        ok: false,
        reason: "file_too_large",
        message: `${slot.kind}: ${err}`,
        issues: [{ field: slot.field, message: err }],
      };
    }
    const err = validateUpload(file, slot.allowed);
    if (err) {
      return {
        ok: false,
        reason: "file",
        message: `${slot.kind}: ${err}`,
        issues: [{ field: slot.field, message: err }],
      };
    }
    picked.push({ slot, file });
  }

  // --- 4. Dateien EINMAL lesen -------------------------------------------
  // Danach arbeiten Fingerprint (API) und Speicherung auf denselben Bytes.
  const prepared: PreparedUpload[] = [];
  for (const p of picked) {
    const bytes = Buffer.from(await p.file.arrayBuffer());
    prepared.push({
      kind: p.slot.kind,
      field: p.slot.field,
      originalName: p.file.name,
      mime: resolveMime(p.file),
      size: p.file.size,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  // --- 5. Zielposition + Standardkonto ------------------------------------
  const targetBoardId = location.targetBoardId;
  const targetStatusId = location.targetStatusId;
  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(eq(cards.boardId, targetBoardId), eq(cards.statusId, targetStatusId)),
    );
  const [board] = await db
    .select({ defaultAccountId: boards.defaultAccountId })
    .from(boards)
    .where(eq(boards.id, targetBoardId))
    .limit(1);
  const position = (maxRow?.m ?? -1) + 1;

  // --- 6. Anlegen ---------------------------------------------------------
  let token = "";
  let cardId = 0;
  let assignedNumber: string | null = null;
  let aborted: { value: T } | null = null;
  const writtenPaths: string[] = [];

  try {
    for (let attempt = 0; ; attempt++) {
      token = generateToken();
      writtenPaths.length = 0;
      aborted = null;
      try {
        await db.transaction(async (tx) => {
          // Vor JEDEM Schreibzugriff: Aufrufer darf abbrechen (Idempotenz).
          // Die Transaktion bleibt dann schreibfrei — ein Commit ohne Wirkung.
          if (opts.preflightTx) {
            const early = await opts.preflightTx(tx, prepared, {
              locationId: parsed.data.locationId,
              title: parsed.data.title,
              applicant: parsed.data.applicant,
            });
            if (early != null) {
              aborted = { value: early };
              return;
            }
          }

          const [inserted] = await tx
            .insert(cards)
            .values({
              boardId: targetBoardId,
              statusId: targetStatusId,
              locationId: location.id,
              title: parsed.data.title,
              applicant: parsed.data.applicant,
              token,
              accountId: board?.defaultAccountId ?? null,
              position,
            })
            .returning();
          cardId = inserted.id;

          await tx.insert(cardActivity).values({
            cardId: inserted.id,
            userId: null,
            type: "created",
            detail: opts.activityDetail,
          });

          // Antragsnummer vergeben (falls aktiv) — die Anhänge werden danach
          // automatisch nach dem Schema „<Antragsnummer>_<Label>" benannt.
          assignedNumber = await assignCardNumberTx(
            tx,
            targetBoardId,
            inserted.id,
          );

          for (const up of prepared) {
            const saved = await saveAntragBuffer(
              inserted.id,
              up.originalName,
              up.bytes,
              up.mime,
            );
            writtenPaths.push(saved.relPath);
            await tx.insert(attachments).values({
              cardId: inserted.id,
              kind: up.kind,
              filename: slotFileName(up.kind, up.originalName, assignedNumber),
              path: saved.relPath,
              mime: saved.mime,
              size: saved.size,
            });
          }

          if (opts.withinTx) {
            await opts.withinTx(tx, {
              cardId: inserted.id,
              token,
              number: assignedNumber,
            });
          }
        });
        break; // erfolgreich (oder sauber abgebrochen)
      } catch (e) {
        // Transaktion rollte zurück → bereits geschriebene Dateien entfernen
        // (sonst Datei-Leichen im Upload-Verzeichnis).
        for (const p of writtenPaths) await deleteStoredFile(p);
        writtenPaths.length = 0;
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
