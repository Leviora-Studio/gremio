// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { requireCashbookEntry } from "@/lib/cashbook/access";
import { absPath } from "@/lib/attachments";
import { zip } from "@/lib/zip";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { entry } = await requireCashbookEntry(await requireUser(), Number((await params).id));
    const files = [];
    for (const file of entry.files) {
        const data = await readFile(absPath(file.path));
        if (createHash("sha256").update(data).digest("hex") !== file.sha256)
            throw new Error("Datei verändert.");
        files.push({ name: `${file.sourceAttachmentId ? `source-${file.sourceAttachmentId}` : file.id.slice(0, 8)}_${file.filename.replace(/[\\/]/g, "_")}`, data });
    }
    return new Response(new Uint8Array(zip(files)), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Vorgang-${entry.id}.zip"`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
catch {
    return new Response("Download nicht verfügbar oder kein Zugriff.", { status: 403 });
} }
