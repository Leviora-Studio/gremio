// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { boards, boardStatuses, locations } from "@/lib/db/schema";
import { LocationEditor } from "@/components/admin/LocationEditor";
import { CreateLocationForm } from "@/components/admin/CreateLocationForm";

export default async function StandortePage() {
  // Nicht nur im Layout: Guard in JEDEM Handler (CLAUDE.md) — Layout-Guards
  // greifen bei segmentgenauen RSC-Navigationsrequests nicht zwingend.
  await requireAdmin();

  const allLocations = await db
    .select()
    .from(locations)
    .orderBy(locations.position);

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
        <h2 className="text-lg font-semibold">Standorte & Formular-Routing</h2>
        <p className="text-sm text-slate-500">
          Pro Standort Ziel-Board und Spalte festlegen. Nur aktivierte Standorte
          erscheinen im öffentlichen Formular; aktivieren ist erst mit gültigem
          Ziel möglich.
        </p>
      </div>

      <CreateLocationForm />

      {allBoards.length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-700">
          Es gibt noch keine Boards. Lege zuerst ein Board an, um Standorte
          darauf zu routen.
        </p>
      )}
      {allLocations.map((loc) => (
        <LocationEditor
          key={loc.id}
          location={{
            id: loc.id,
            name: loc.name,
            enabled: loc.enabled,
            targetBoardId: loc.targetBoardId,
            targetStatusId: loc.targetStatusId,
          }}
          boards={boardsWithStatuses}
        />
      ))}
    </div>
  );
}
