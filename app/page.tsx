// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { formDocuments } from "@/lib/db/schema";
import { makeFormGuard } from "@/lib/antispam";
import { listPublicLocations } from "@/lib/public-application-submission";
import { PublicAntragForm } from "@/components/PublicAntragForm";
import { PublicNav } from "@/components/PublicNav";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Gemeinsame Quelle mit der öffentlichen API: aktiviert UND vollständig
  // geroutet. Ein Standort ohne gültiges Ziel darf gar nicht erst zur Auswahl
  // stehen — die Einreichung würde ihn ohnehin abweisen.
  const enabled = await listPublicLocations();
  const docs = await db
    .select({ id: formDocuments.id, filename: formDocuments.filename })
    .from(formDocuments)
    .orderBy(asc(formDocuments.position), asc(formDocuments.id));
  const guard = await makeFormGuard();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <PublicNav current="antrag" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Antrag einreichen</h1>
      </div>
      <p className="mb-6 text-slate-600">
        Reiche hier deinen Antrag ein. Nach dem Absenden erhältst du einen Link,
        über den du den Status verfolgen kannst.
      </p>

      {enabled.length === 0 ? (
        <div className="card p-6 text-slate-600">
          Aktuell ist keine Antragstellung möglich (kein Standort aktiviert).
        </div>
      ) : (
        <div className="card p-6">
          <PublicAntragForm locations={enabled} guard={guard} />
        </div>
      )}

      {docs.length > 0 && (
        <div className="card mt-6 p-6">
          <h2 className="mb-3 text-lg font-semibold">Wichtige Dokumente</h2>
          <ul className="space-y-2 text-sm">
            {docs.map((d) => (
              <li key={d.id}>
                <a
                  href={`/api/form-document/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="text-brand-600 hover:underline"
                >
                  📄 {d.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
