// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { db } from "@/lib/db";
import { boards, boardStatuses, feedbackAreas } from "@/lib/db/schema";
import { FeedbackAreaEditor } from "@/components/admin/FeedbackAreaEditor";
import { CreateFeedbackAreaForm } from "@/components/admin/CreateFeedbackAreaForm";

export const metadata = { title: "Umfragen — Gremio" };

export default async function UmfragenPage() {
  const allAreas = await db
    .select()
    .from(feedbackAreas)
    .orderBy(feedbackAreas.position, feedbackAreas.id);

  const allBoards = await db.select().from(boards).orderBy(boards.name);
  const allStatuses = await db
    .select()
    .from(boardStatuses)
    .orderBy(boardStatuses.position);

  const boardsWithStatuses = allBoards.map((b) => ({
    id: b.id,
    name: b.name,
    statuses: allStatuses
      .filter((s) => s.boardId === b.id)
      .map((s) => ({ id: s.id, name: s.name })),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Umfragen &amp; Feedback-Routing</h2>
        <p className="text-sm text-slate-500">
          Pro Bereich Ziel-Board und Spalte festlegen. Nur aktivierte Bereiche
          erscheinen im öffentlichen Feedback-Formular unter <code>/feedback</code>;
          aktivieren ist erst mit gültigem Ziel möglich.
        </p>
      </div>

      <CreateFeedbackAreaForm />

      {allBoards.length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-700">
          Es gibt noch keine Boards. Lege zuerst ein Board an, um Bereiche darauf
          zu routen.
        </p>
      )}
      {allAreas.length === 0 && allBoards.length > 0 && (
        <p className="card p-6 text-center text-sm text-slate-500">
          Noch keine Bereiche angelegt.
        </p>
      )}
      {allAreas.map((area) => (
        <FeedbackAreaEditor
          key={area.id}
          area={{
            id: area.id,
            name: area.name,
            enabled: area.enabled,
            targetBoardId: area.targetBoardId,
            targetStatusId: area.targetStatusId,
          }}
          boards={boardsWithStatuses}
        />
      ))}
    </div>
  );
}
