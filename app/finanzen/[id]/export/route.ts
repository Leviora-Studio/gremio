// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { requireFinanceAccess } from "@/lib/finance";
import { loadFinanceData } from "@/lib/finance-data";
import { buildFinanceTable, VIEW_TITLES } from "@/lib/finance-export";
import { tablesToPdf, tablesToXlsx } from "@/lib/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "export"
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { fb } = await requireFinanceAccess(Number(id));

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "plan";
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";

  const data = await loadFinanceData(fb);
  const table = buildFinanceTable(view, data);
  const stand = new Date().toLocaleDateString("de-DE");
  const accountLabel = data.accountNames.length
    ? data.accountNames.join(", ")
    : "—";
  table.subtitle = `${fb.name} · ${data.accountNames.length > 1 ? "Konten" : "Konto"}: ${accountLabel} · Stand: ${stand}`;

  const base = `${slug(fb.name)}_${VIEW_TITLES[view] ?? view}`;
  const filename = `${slug(base)}.${format}`;

  if (format === "pdf") {
    const bytes = await tablesToPdf(`${fb.name} — ${table.title}`, [table]);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const bytes = await tablesToXlsx([table]);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
