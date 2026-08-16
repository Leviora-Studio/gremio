// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

/** Excel-/PDF-Download-Links für eine Finanz-View. */
export function ExportButtons({
  fbId,
  view,
  label = "Export:",
  className = "mb-3 flex items-center gap-2",
}: {
  fbId: number;
  view: string;
  label?: string;
  /** Wrapper-Klassen überschreibbar (z.B. ohne mb-3, wenn in einer Zeile gruppiert). */
  className?: string;
}) {
  const base = `/finanzen/${fbId}/export?view=${view}`;
  return (
    <div className={className}>
      <span className="text-xs uppercase text-slate-400">{label}</span>
      <a href={`${base}&format=xlsx`} className="btn-secondary btn-sm">
        Excel
      </a>
      <a href={`${base}&format=pdf`} className="btn-secondary btn-sm">
        PDF
      </a>
    </div>
  );
}
