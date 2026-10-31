// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import type {FinanceDetails as Details} from "@/lib/meetings/finance-projection";
export function FinanceDetails({details}:{details?:Details}) {
  if(!details)return <p className="text-sm text-slate-500">Die Karte ist nicht mehr verfügbar oder du hast keinen Zugriff auf das Antragsboard.</p>;
  return <div className="space-y-4"><dl className="grid gap-4 sm:grid-cols-2">{[{label:"Antragsteller",value:details.applicant},{label:"Konto",value:details.account},{label:"Haushaltstitel",value:details.budgetTitle},{label:"Beantragter Betrag",value:details.amount}].map(row=><div key={row.label}><dt className="text-xs text-slate-500">{row.label}</dt><dd className="mt-1 break-words text-sm font-medium">{row.value}</dd></div>)}</dl><Link className="btn-secondary max-w-full h-auto min-h-10 py-2 whitespace-normal" href={`/intern/card/${details.cardId}`}>Interne Karte öffnen →</Link></div>;
}
