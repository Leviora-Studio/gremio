// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import type { CashbookFile } from "@/lib/cashbook-types";
import { cashbookActivityChanges, formatCashbookActivityValue } from "@/lib/cashbook/activity-display";

export function ActivityDetails({ detail, people, files = [] }: {
    detail: Record<string, unknown>;
    people: Record<string, string>;
    files?: CashbookFile[];
}) {
    const { rows, comparison, hasComparison } = cashbookActivityChanges(detail);
    const display = (key: string, value: unknown, snapshot: unknown = detail.after ?? detail.data) =>
        formatCashbookActivityValue(key, value, people, {
            payment: snapshot != null && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : null,
            files,
        });

    return <div className="mt-3 space-y-3 text-sm">
        {detail.comment != null && String(detail.comment).trim() && <p className="whitespace-pre-wrap">{String(detail.comment)}</p>}
        {detail.reason != null && <p className="whitespace-pre-wrap">Begründung: {String(detail.reason)}</p>}
        {detail.role != null && <p>Unterschreibende Rolle: {display("role", detail.role)}</p>}
        {detail.filename != null && <p>Datei: {String(detail.filename)}</p>}
        {rows.length > 0 ? <div className="overflow-x-auto">
            <table className="w-full text-left">
                <caption className="mb-2 text-left text-slate-500">{comparison ? "Geänderte Angaben – unveränderte Angaben werden nicht aufgeführt." : "Bei diesem Schritt erfasste Angaben"}</caption>
                <thead><tr><th scope="col" className="p-2">Angabe</th>{comparison && <th scope="col" className="p-2">Vorher</th>}<th scope="col" className="p-2">{comparison ? "Nachher" : "Wert"}</th></tr></thead>
                <tbody>{rows.map(row => <tr key={row.key} className="border-t border-slate-100">
                    <th scope="row" className="p-2 font-medium">{row.label}</th>
                    {comparison && <td className="whitespace-pre-line break-words p-2">{row.hasBefore ? display(row.key, row.before, detail.before) : "Nicht protokolliert"}</td>}
                    <td className="whitespace-pre-line break-words p-2">{display(row.key, row.after)}</td>
                </tr>)}</tbody>
            </table>
        </div> : hasComparison && <p className="text-slate-500">Keine Angaben geändert.</p>}
        {Array.isArray(detail.files) && detail.files.map((file: Record<string, unknown>, index: number) => <p key={index}>Datei erstellt: {String(file.filename)}</p>)}
    </div>;
}
