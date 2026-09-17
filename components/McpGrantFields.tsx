// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";
import { useState } from "react";
export function McpGrantFields({
  boards,
  scope = "read",
  allBoards = false,
  boardIds = [],
}: {
  boards: { id: number; name: string }[];
  scope?: "read" | "write";
  allBoards?: boolean;
  boardIds?: number[];
}) {
  const [all, setAll] = useState(allBoards);
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Berechtigungen</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scope"
            value="read"
            defaultChecked={scope === "read"}
          />{" "}
          Nur lesen
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scope"
            value="write"
            defaultChecked={scope === "write"}
          />{" "}
          Lesen und schreiben, einschließlich Löschen
        </label>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Freigegebene Boards</legend>
        <label className="flex items-start gap-2">
          <input
            className="mt-1"
            type="checkbox"
            name="allBoards"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          <span>Alle meine Boards, einschließlich zukünftiger</span>
        </label>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-3">
          {boards.length ? (
            boards.map((b) => (
              <label
                key={b.id}
                className={`flex items-start gap-2 ${all ? "text-slate-400" : ""}`}
              >
                <input
                  className="mt-1"
                  type="checkbox"
                  name="boardId"
                  value={b.id}
                  disabled={all}
                  defaultChecked={boardIds.includes(b.id)}
                />
                <span className="break-words">{b.name}</span>
              </label>
            ))
          ) : (
            <p className="text-sm text-slate-500">Keine Boards verfügbar.</p>
          )}
        </div>
      </fieldset>
    </div>
  );
}
