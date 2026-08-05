// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { makeFormGuard } from "@/lib/antispam";
import { listPublicFeedbackAreas } from "@/lib/public-feedback-submission";
import { PublicFeedbackForm } from "@/components/PublicFeedbackForm";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback geben — Gremio" };

export default async function FeedbackPage() {
  // Nur aktivierte UND vollständig/korrekt geroutete Bereiche (identische
  // Bedingung wie die API und die Einreichungslogik).
  const areas = await listPublicFeedbackAreas();
  const guard = await makeFormGuard();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <PublicNav current="feedback" />
      <h1 className="text-2xl font-bold">Feedback geben</h1>
      <p className="mb-6 mt-2 text-slate-600">
        Teile dem Gremium deine Anregungen, Kritik oder Ideen mit. Nach dem
        Absenden erhältst du einen Link, über den du den Status verfolgen kannst.
      </p>

      {areas.length === 0 ? (
        <div className="card p-6 text-slate-600">
          Aktuell ist keine Feedback-Einreichung möglich.
        </div>
      ) : (
        <div className="card p-6">
          <PublicFeedbackForm areas={areas} guard={guard} />
        </div>
      )}
    </main>
  );
}
