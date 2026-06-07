// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards as boardsTable, cards, userTaskPrefs } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";
import { getAccessibleFinanceBoards } from "@/lib/finance";
import {
  sortByUserBoardOrder,
  sortByUserFinanceBoardOrder,
} from "@/lib/board-order";
import { loadTaskOverviewData } from "@/lib/task-overview-data";
import { SortableBoardGrid } from "@/components/SortableBoardGrid";
import { TaskOverview } from "@/components/TaskOverview";
import { HomeDashboard } from "@/components/HomeDashboard";
import { reorderBoardsAction } from "./actions";
import { reorderFinanceBoardsAction } from "../finanzen/actions";
import type { HomePref, TaskPrefs } from "./aufgaben/actions";

export default async function InternHome() {
  const user = await requireUser();

  const [prefRow] = await db
    .select({ config: userTaskPrefs.config })
    .from(userTaskPrefs)
    .where(eq(userTaskPrefs.userId, user.id))
    .limit(1);
  const prefs = (prefRow?.config as TaskPrefs) ?? {};
  const home: HomePref = {
    tasks: prefs.home?.tasks !== false,
    boards: prefs.home?.boards !== false,
    finances: prefs.home?.finances !== false,
  };

  // --- Meine Aufgaben ---
  const taskData = await loadTaskOverviewData(user);
  const tasksNode = (
    <TaskOverview
      cards={taskData.cards}
      boards={taskData.boards}
      statusesByBoard={taskData.statusesByBoard}
      priorities={taskData.priorities}
      prefs={prefs}
    />
  );

  // --- Boards ---
  const boards = await sortByUserBoardOrder(
    user.id,
    await getAccessibleBoards(user),
  );

  // --- Nextcloud-Archiv-Dauerfehler (> 24 h) auf zugänglichen Boards ---
  const accessibleBoardIds = boards.map((b) => b.id);
  const archiveFailures = accessibleBoardIds.length
    ? await db
        .select({
          id: cards.id,
          title: cards.title,
          boardName: boardsTable.name,
          error: cards.archiveLastError,
        })
        .from(cards)
        .innerJoin(boardsTable, eq(boardsTable.id, cards.boardId))
        .where(
          and(
            inArray(cards.boardId, accessibleBoardIds),
            eq(cards.archivePending, true),
            isNull(cards.nextcloudLink),
            lte(
              cards.archiveFirstFailedAt,
              new Date(Date.now() - 24 * 60 * 60 * 1000),
            ),
          ),
        )
    : [];
  const boardsNode = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Deine Boards</h2>
        <Link href="/intern/board/neu" className="btn-primary">
          + Neues Board
        </Link>
      </div>
      {boards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Du hast noch keine Boards.
        </div>
      ) : (
        <SortableBoardGrid
          hrefBase="/intern/board/"
          action={reorderBoardsAction}
          boards={boards.map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
            isOwner: b.ownerId === user.id,
          }))}
        />
      )}
    </div>
  );

  // --- Finanzübersichten ---
  const financeBoards = await sortByUserFinanceBoardOrder(
    user.id,
    await getAccessibleFinanceBoards(user),
  );
  const financesNode = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Finanzübersichten</h2>
        <Link href="/finanzen/neu" className="btn-primary">
          + Neue Finanzübersicht
        </Link>
      </div>
      {financeBoards.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Noch keine Finanzübersicht.
        </div>
      ) : (
        <SortableBoardGrid
          hrefBase="/finanzen/"
          action={reorderFinanceBoardsAction}
          boards={financeBoards.map((fb) => ({
            id: fb.id,
            name: fb.name,
            description: fb.description,
            isOwner: fb.ownerId === user.id,
          }))}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {archiveFailures.length > 0 && (
        <div className="card border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-800">
            ⚠ Nextcloud-Archivierung seit über 24 h fehlgeschlagen
          </h2>
          <p className="mt-1 text-sm text-red-700">
            Diese Anträge konnten nicht ins Nextcloud-Archiv hochgeladen werden
            (die App versucht es weiter automatisch). Bitte Verbindung und
            Zugangsdaten in den Board-Einstellungen prüfen.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {archiveFailures.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/intern/card/${f.id}`}
                  className="font-medium text-red-800 hover:underline"
                >
                  {f.title}
                </Link>
                <span className="text-red-600">
                  {" — "}
                  {f.boardName}
                  {f.error ? `: ${f.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <HomeDashboard
        home={home}
        tasks={tasksNode}
        boards={boardsNode}
        finances={financesNode}
      />
    </div>
  );
}
