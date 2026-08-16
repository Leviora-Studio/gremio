// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formDocuments } from "@/lib/db/schema";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { FormDocUpload } from "@/components/admin/FormDocUpload";
import { deleteFormDocumentAction } from "./actions";

export const metadata = { title: "Antragsformular — Gremio" };

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AntragsformularPage() {
  await requireAdmin();
  const docs = await db
    .select()
    .from(formDocuments)
    .orderBy(asc(formDocuments.position), asc(formDocuments.id));

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Antragsformular</h2>
        <p className="text-sm text-slate-500">
          Lege hier Dateien ab. Sie werden auf der öffentlichen Antragsseite
          unter der Überschrift „Wichtige Dokumente" zum Ansehen/Herunterladen
          angezeigt.
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <h3 className="text-sm font-semibold text-slate-700">Wichtige Dokumente</h3>

        {docs.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Dokumente abgelegt.</p>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2"
              >
                <a
                  href={`/api/form-document/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="min-w-0 truncate text-sm text-brand-600 hover:underline"
                >
                  📄 {d.filename}
                </a>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">{fmtSize(d.size)}</span>
                  <DeleteConfirm
                    action={deleteFormDocumentAction.bind(null, d.id)}
                    requireWord={false}
                    compact
                    buttonLabel="löschen"
                    buttonClassName="text-xs text-red-600 hover:underline"
                    title={`Datei „${d.filename}" löschen`}
                    message="Die Datei wird von der Antragsseite entfernt."
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <FormDocUpload />
      </div>
    </div>
  );
}
