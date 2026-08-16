// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userTaskPrefs } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { loadTaskOverviewData } from "@/lib/task-overview-data";
import { TaskOverview } from "@/components/TaskOverview";
import type { TaskPrefs } from "./actions";

export const metadata = { title: "Meine Aufgaben — Gremio" };

export default async function AufgabenPage() {
  const user = await requireUser();
  const data = await loadTaskOverviewData(user);

  const [prefRow] = await db
    .select({ config: userTaskPrefs.config })
    .from(userTaskPrefs)
    .where(eq(userTaskPrefs.userId, user.id))
    .limit(1);
  const prefs = (prefRow?.config as TaskPrefs) ?? {};

  return (
    <div className="mx-auto max-w-4xl">
      <TaskOverview
        cards={data.cards}
        boards={data.boards}
        statusesByBoard={data.statusesByBoard}
        priorities={data.priorities}
        prefs={prefs}
      />
    </div>
  );
}
