// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cashbookEntries } from "@/lib/db/schema";
import { deleteStoredFile } from "@/lib/attachments";
import type { CashbookFile } from "@/lib/cashbook-types";

export function isInstructionFile(file: Pick<CashbookFile, "kind">): boolean {
    return file.kind === "form" || file.kind === "prepared" || file.kind === "signed";
}

/** Only the current instruction is attached; source documents are independent. */
export function replaceInstructionFiles(files: CashbookFile[], current?: CashbookFile): CashbookFile[] {
    return [...files.filter(file => !isInstructionFile(file)), ...(current ? [current] : [])];
}

/** Run only after commit, without row locks. Keep copies referenced by any entry,
 * including immutable corrections and books in the recycle bin. */
export async function removeReplacedInstructions(previous: CashbookFile[]): Promise<void> {
    for (const path of new Set(previous.filter(isInstructionFile).map(file => file.path))) {
        try {
            const references = await db.select({ id: cashbookEntries.id }).from(cashbookEntries)
                .where(sql`${cashbookEntries.files} @> ${JSON.stringify([{ path }])}::jsonb`).limit(1);
            if (!references.length) await deleteStoredFile(path);
        } catch {
            // A committed replacement must never be reported as failed or removed.
            console.error("[cashbook] Replaced instruction file cleanup failed");
        }
    }
}
