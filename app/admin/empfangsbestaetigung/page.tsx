// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {createHash} from "node:crypto";
import {requireAdmin} from "@/lib/auth";
import {getReceiptBranding} from "@/lib/receipt-branding";
import {ReceiptBrandingForm} from "@/components/admin/ReceiptBrandingForm";
export default async function ReceiptBrandingPage(){await requireAdmin();const current=await getReceiptBranding();return <div className="mx-auto max-w-3xl space-y-6"><div><h1 className="text-2xl font-bold">Empfangsbestätigungen</h1><p className="mt-2 text-sm text-slate-500">Standard für Briefkopf und Logo öffentlicher Einreichungen. Eigene Gestaltungen kannst du direkt bei Standorten und Umfragen aufklappen und hinterlegen. Die SMTP-Einstellungen und Versandregeln bleiben separat.</p></div><section className="card p-6"><ReceiptBrandingForm organization={current.organization==="Gremio"?"":current.organization} hasLogo={!!current.logoPng} version={current.logoPng?createHash("sha256").update(current.logoPng).digest("hex").slice(0,16):""}/></section></div>;}
