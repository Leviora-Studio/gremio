// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cards } from "@/lib/db/schema";
import { requireBoardAccess } from "@/lib/authz";
import { SubmitButton } from "@/components/SubmitButton";
import { LiveRefresh } from "@/components/LiveRefresh";
import { restoreCardAction } from "./actions";

export default async function BoardArchivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boardId = Number(id);
  const { board } = await requireBoardAccess(boardId);

  const rows = await db
    .select({
      id: cards.id,
      number: cards.number,
      title: cards.title,
      applicant: cards.applicant,
      archivedAt: cards.archivedAt,
      statusName: boardStatuses.name,
    })
    .from(cards)
    .leftJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(and(eq(cards.boardId, boardId), isNotNull(cards.archivedAt)))
    .orderBy(desc(cards.archivedAt));

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <LiveRefresh src={`/api/board/${boardId}/stream`} />
      <div>
        <Link href={`/intern/board/${boardId}`} className="text-sm text-brand-600">
          ← Zurück zum Board
        </Link>
        <h1 className="text-2xl font-bold">Archiv: {board.name}</h1>
        <p className="text-sm text-slate-500">
          Erledigte Karten aus der Done-Spalte. Sie sind ausgeblendet, aber nicht
          gelöscht — über „Zurückholen" landen sie wieder auf dem Board.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Noch keine archivierten Karten.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/intern/card/${c.id}`}
                  className="font-medium text-slate-800 hover:text-brand-600"
                >
                  {c.number ? (
                    <span className="text-slate-400">{c.number} · </span>
                  ) : null}
                  {c.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {c.applicant ? `${c.applicant} · ` : ""}
                  aus „{c.statusName ?? "?"}" · archiviert{" "}
                  {c.archivedAt
                    ? new Date(c.archivedAt).toLocaleString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </p>
              </div>
              <form action={restoreCardAction.bind(null, boardId, c.id)}>
                <SubmitButton className="btn-secondary btn-sm shrink-0">
                  ↩ Zurückholen
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
