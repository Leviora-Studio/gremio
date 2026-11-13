// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { requireCashbookEntry } from "@/lib/cashbook/access";
import { absPath } from "@/lib/attachments";
export async function GET(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    try {
        const { entry } = await requireCashbookEntry(await requireUser(), Number((await params).id));
        const id = new URL(request.url).searchParams.get("file");
        const file = id ? entry.files.find(f => f.id === id) : [...entry.files].reverse().find(f => (f.kind === "form" || f.kind === "prepared" || f.kind === "signed") && !f.obsolete);
        if (!file)
            return new Response("Datei nicht verfügbar.", { status: 404 });
        const bytes = await readFile(absPath(file.path));
        if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
            return new Response("Dateiprüfung fehlgeschlagen.", { status: 409 });
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": file.mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
    }
    catch {
        return new Response("Sie haben nicht die nötigen Rechte.", { status: 403 });
    }
}
