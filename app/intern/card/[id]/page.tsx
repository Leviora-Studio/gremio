// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cards,
  attachments,
  boardCardFields,
  boardStatuses,
  cardComments,
  cardActivity,
  inventoryLoans,
  locations,
  users,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import { getPriorities } from "@/lib/priorities";
import { getAccounts } from "@/lib/accounts";
import { getCardAssignees } from "@/lib/assignees";
import { centsToInput } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { publicBaseUrl } from "@/lib/public-api";
import { CardEditor } from "@/components/antrag/CardEditor";
import { CommentForm } from "@/components/antrag/CommentForm";
import { StatusSelect } from "@/components/antrag/StatusSelect";
import { AttachmentSlot, WeitereAttachments } from "@/components/antrag/Attachments";
import { Avatar } from "@/components/Avatar";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { BackButton } from "@/components/BackButton";
import type { AttachmentKind } from "@/lib/constants";
import { getFeedbackByCardId } from "@/lib/public-feedback-submission";
import { deleteCardAction, deleteCommentAction } from "./actions";

function fmt(d: Date) {
  return formatDateTime(d, "medium");
}

export default async function AntragDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId)) notFound();
  const user = await requireUser();
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) notFound();

  // Leihvorgang-Karte: immer die Leih-Detailansicht öffnen (egal ob man über
  // das Board oder das Inventar navigiert). Deren Guard prüft den Zugriff.
  const [linkedLoan] = await db
    .select({ id: inventoryLoans.id })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.cardId, cardId))
    .limit(1);
  if (linkedLoan) redirect(`/intern/inventar/loan/${linkedLoan.id}`);

  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) notFound();

  const statuses = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, board.id))
    .orderBy(asc(boardStatuses.position));

  const visibleRows = await db
    .select()
    .from(boardCardFields)
    .where(and(eq(boardCardFields.boardId, board.id), eq(boardCardFields.visible, true)))
    .orderBy(asc(boardCardFields.position));
  const visible = visibleRows.map((r) => r.fieldKey);
  const priorities = await getPriorities();
  const accounts = await getAccounts();

  const atts = await db
    .select()
    .from(attachments)
    .where(eq(attachments.cardId, card.id));
  const slot = (k: AttachmentKind) => {
    const a = atts.find((x) => x.kind === k);
    return a ? { id: a.id, filename: a.filename, mime: a.mime } : null;
  };
  const other = atts
    .filter((a) => a.kind === "other")
    .map((a) => ({ id: a.id, filename: a.filename, mime: a.mime }));
  // Hat der eingeloggte Nutzer ein Signatur-Zertifikat? (für den Signieren-Button)
  const hasCert = !!user.certP12Enc;

  // Zugewiesene (mehrere) separat aus card_assignees laden.
  const assignees = await getCardAssignees(card.id);
  // Ersteller-Name
  const userIds = [card.creatorUserId].filter((x): x is number => !!x);
  const userMap = new Map<
    number,
    { username: string; name: string | null; avatarPath: string | null }
  >();
  if (userIds.length) {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        avatarPath: users.avatarPath,
      })
      .from(users)
      .where(inArray(users.id, userIds));
    rows.forEach((u) =>
      userMap.set(u.id, {
        username: u.username,
        name: u.name,
        avatarPath: u.avatarPath,
      }),
    );
  }
  const creator = card.creatorUserId
    ? {
        id: card.creatorUserId,
        username: userMap.get(card.creatorUserId)?.username ?? "?",
        name: userMap.get(card.creatorUserId)?.name ?? null,
        avatarPath: userMap.get(card.creatorUserId)?.avatarPath ?? null,
      }
    : null;
  const location = card.locationId
    ? (
        await db
          .select()
          .from(locations)
          .where(eq(locations.id, card.locationId))
          .limit(1)
      )[0]
    : null;

  // Feedback-Karten haben eine eigene Statusseite; die Antragsroute liefert für
  // sie bewusst 404. Der interne Link muss deshalb mitziehen.
  //
  // Leih-Tracking-Karten haben GAR KEINEN Karten-Status-Link: Der öffentliche
  // Weg des Vorgangs hängt an `inventory_loans.token`
  // (/inventar/status/{token}) und steht auf der Vorgangsseite. Ihr
  // `cards.token` existiert nur, weil die Spalte NOT NULL ist; die
  // Antragsroute weist ihn inzwischen mit 404 ab — dann darf hier auch kein
  // Link mehr stehen, der ins Leere führt.
  const feedback = await getFeedbackByCardId(card.id);
  const statusLink =
    board.inventoryBoardId != null
      ? null
      : feedback
        ? `${publicBaseUrl()}/feedback/status/${card.token}`
        : `${publicBaseUrl()}/status/${card.token}`;
  const manage = canManageBoard(user, board);

  const comments = await db
    .select({
      id: cardComments.id,
      body: cardComments.body,
      createdAt: cardComments.createdAt,
      userId: cardComments.userId,
      username: users.username,
      avatarPath: users.avatarPath,
    })
    .from(cardComments)
    .leftJoin(users, eq(users.id, cardComments.userId))
    .where(eq(cardComments.cardId, card.id))
    .orderBy(asc(cardComments.createdAt));

  const activity = await db
    .select({
      id: cardActivity.id,
      type: cardActivity.type,
      detail: cardActivity.detail,
      createdAt: cardActivity.createdAt,
      userId: cardActivity.userId,
      username: users.username,
      avatarPath: users.avatarPath,
    })
    .from(cardActivity)
    .leftJoin(users, eq(users.id, cardActivity.userId))
    .where(eq(cardActivity.cardId, card.id))
    .orderBy(desc(cardActivity.createdAt));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <BackButton label="Zurück" />
          <Link
            href={`/intern/board/${board.id}`}
            className="text-slate-500 hover:text-brand-600"
          >
            ↗ Zum Board „{board.name}"
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-bold">{card.title}</h1>
      </div>

      {/* Meta + Status */}
      <section className="card grid gap-3 p-4 text-sm sm:grid-cols-2">
        <div>
          <span className="text-slate-500">Erstellt:</span> {fmt(card.createdAt)}
        </div>
        <div>
          <span className="text-slate-500">Letzte Änderung:</span> {fmt(card.updatedAt)}
        </div>
        {location && (
          <div>
            <span className="text-slate-500">Herkunft (Standort):</span> {location.name}
          </div>
        )}
        {feedback && (
          <>
            <div>
              <span className="text-slate-500">Herkunft:</span> Feedback
            </div>
            <div>
              {/* Snapshot-Name: bleibt auch dann korrekt, wenn der Bereich
                  später umbenannt oder gelöscht wurde. */}
              <span className="text-slate-500">Bereich:</span> {feedback.areaName}
            </div>
          </>
        )}
        {statusLink && (
          <div className="sm:col-span-2">
            <span className="text-slate-500">Status-Link:</span>{" "}
            <a href={statusLink} className="break-all text-brand-600 hover:underline" target="_blank" rel="noopener">
              {statusLink}
            </a>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Status</label>
          <div>
            <StatusSelect
              cardId={card.id}
              statuses={statuses.map((s) => ({ id: s.id, name: s.name }))}
              current={card.statusId}
            />
          </div>
        </div>
      </section>

      {/* Felder (Auto-Speichern) */}
      <section className="card p-5">
        <h2 className="mb-2 text-lg font-semibold">Felder</h2>
        <CardEditor
          cardId={card.id}
          boardId={board.id}
          visible={visible}
          initial={{
            title: card.title,
            applicant: card.applicant,
            budgetTitle: card.budgetTitle,
            number: card.number,
            deadline: card.deadline,
            meeting: card.meeting,
            decisionRef: card.decisionRef,
            instructionDate: card.instructionDate,
            transferDate: card.transferDate,
            approvedAmount: centsToInput(card.approvedAmount),
            actualAmount: centsToInput(card.actualAmount),
            priorityId: card.priorityId,
            accountId: card.accountId,
            notes: card.notes,
            applicantNote: card.applicantNote,
          }}
          creator={creator}
          assignees={assignees}
          priorities={priorities}
          accounts={accounts}
          applicantLabel={feedback ? "Einreicher" : "Antragsteller"}
        />
      </section>

      {/* Anhänge */}
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Anhänge</h2>
          {atts.length > 0 && (
            <a
              href={`/api/card/${card.id}/zip`}
              className="btn-secondary btn-sm"
              title="Alle Dokumente dieses Antrags als ZIP herunterladen"
            >
              ⬇ Alle als ZIP
            </a>
          )}
        </div>
        {visible.includes("finance_request") && (
          <AttachmentSlot
            cardId={card.id}
            kind="finance_request"
            label="Finanzantrag (PDF)"
            accept="application/pdf,.pdf"
            current={slot("finance_request")}
            hasCert={hasCert}
          />
        )}
        {visible.includes("student_card") && (
          <AttachmentSlot
            cardId={card.id}
            kind="student_card"
            label="Studierendenausweis (PDF/PNG/JPG)"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            current={slot("student_card")}
            hasCert={hasCert}
          />
        )}
        {visible.includes("annex_a") && (
          <AttachmentSlot
            cardId={card.id}
            kind="annex_a"
            label="Anlage A (PDF)"
            accept="application/pdf,.pdf"
            current={slot("annex_a")}
            hasCert={hasCert}
          />
        )}
        {visible.includes("annex_b") && (
          <AttachmentSlot
            cardId={card.id}
            kind="annex_b"
            label="Anlage B (PDF)"
            accept="application/pdf,.pdf"
            current={slot("annex_b")}
            hasCert={hasCert}
          />
        )}
        {visible.includes("other_pdfs") && (
          <WeitereAttachments cardId={card.id} items={other} hasCert={hasCert} />
        )}
      </section>

      {/* Kommentare */}
      <section className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold">Kommentare</h2>
        <CommentForm cardId={card.id} />
        <div className="space-y-3">
          {comments.length === 0 && (
            <p className="text-sm text-slate-500">Noch keine Kommentare.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <Avatar
                username={c.username ?? "?"}
                src={c.userId && c.avatarPath ? `/api/avatar/${c.userId}` : null}
                size={32}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{c.username ?? "Unbekannt"}</span>
                  <span className="text-slate-400">{fmt(c.createdAt)}</span>
                  {(manage || c.userId === user.id) && (
                    <div className="ml-auto">
                      <DeleteConfirm
                        action={deleteCommentAction.bind(null, card.id, c.id)}
                        requireWord={false}
                        compact
                        buttonLabel="Löschen"
                        buttonClassName="btn-secondary btn-sm"
                        title="Kommentar löschen"
                        message="Der Kommentar wird dauerhaft entfernt."
                      />
                    </div>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {c.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Aktivität (rein intern) */}
      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold">Aktivität</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Aktivität.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {activity.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start gap-x-2 gap-y-1 text-slate-600 sm:items-center"
              >
                <Avatar
                  username={a.username ?? "System"}
                  src={
                    a.userId && a.avatarPath ? `/api/avatar/${a.userId}` : null
                  }
                  size={20}
                  className="mt-0.5 shrink-0 sm:mt-0"
                />
                <span className="shrink-0 font-medium text-slate-700">
                  {a.username ?? "System"}
                </span>
                <span className="min-w-0 flex-1 break-words">{a.detail}</span>
                <span className="basis-full pl-7 text-xs text-slate-400 sm:ml-auto sm:basis-auto sm:pl-0">
                  {fmt(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Löschen */}
      <section className="card border-red-200 p-4">
        <DeleteConfirm
          action={deleteCardAction.bind(null, card.id)}
          requireWord={false}
          buttonLabel="Karte löschen"
          buttonClassName="btn-danger"
          title="Karte löschen"
          message="Die Karte wird inklusive aller Anhänge unwiderruflich gelöscht."
        />
      </section>
    </div>
  );
}
