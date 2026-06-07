// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { boardTemplates, boardTemplateStatuses } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";

export type State = { error?: string; success?: string };

const nameSchema = z.object({
  name: z.string().min(1, "Name erforderlich.").max(120),
  description: z.string().max(300).optional(),
});

function rev(templateId: number) {
  revalidatePath("/vorlagen/boards");
  revalidatePath(`/vorlagen/boards/${templateId}`);
}

export async function createTemplateAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const parsed = nameSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const exists = await db
    .select({ id: boardTemplates.id })
    .from(boardTemplates)
    .where(eq(boardTemplates.name, parsed.data.name))
    .limit(1);
  if (exists.length) return { error: "Template-Name bereits vergeben." };

  const [tpl] = await db
    .insert(boardTemplates)
    .values({ name: parsed.data.name, description: parsed.data.description ?? null })
    .returning();
  redirect(`/vorlagen/boards/${tpl.id}`);
}

export async function renameTemplateAction(
  templateId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const parsed = nameSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültig." };
  }
  const clash = await db
    .select({ id: boardTemplates.id })
    .from(boardTemplates)
    .where(eq(boardTemplates.name, parsed.data.name))
    .limit(1);
  if (clash[0] && clash[0].id !== templateId) {
    return { error: "Template-Name bereits vergeben." };
  }
  await db
    .update(boardTemplates)
    .set({ name: parsed.data.name, description: parsed.data.description ?? null })
    .where(eq(boardTemplates.id, templateId));
  rev(templateId);
  return { success: "Gespeichert." };
}

export async function deleteTemplateAction(templateId: number): Promise<void> {
  await requireTemplateManager();
  await db.delete(boardTemplates).where(eq(boardTemplates.id, templateId));
  revalidatePath("/vorlagen/boards");
}

export async function addTemplateStatusAction(
  templateId: number,
  formData: FormData,
): Promise<void> {
  await requireTemplateManager();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const [row] = await db
    .select({ m: max(boardTemplateStatuses.position) })
    .from(boardTemplateStatuses)
    .where(eq(boardTemplateStatuses.templateId, templateId));
  await db
    .insert(boardTemplateStatuses)
    .values({ templateId, name, position: (row?.m ?? -1) + 1 });
  rev(templateId);
}

export async function renameTemplateStatusAction(
  templateId: number,
  statusId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name erforderlich." };
  await db
    .update(boardTemplateStatuses)
    .set({ name })
    .where(
      and(
        eq(boardTemplateStatuses.id, statusId),
        eq(boardTemplateStatuses.templateId, templateId),
      ),
    );
  rev(templateId);
  return { success: "Gespeichert." };
}

/** Komplette neue Reihenfolge der Spalten setzen (Drag&Drop). */
export async function reorderTemplateStatusesAction(
  templateId: number,
  orderedIds: number[],
): Promise<void> {
  await requireTemplateManager();
  const rows = await db
    .select({ id: boardTemplateStatuses.id })
    .from(boardTemplateStatuses)
    .where(eq(boardTemplateStatuses.templateId, templateId));
  const valid = new Set(rows.map((r) => r.id));
  const ordered = orderedIds.filter((id) => valid.has(id));
  for (const r of rows) if (!ordered.includes(r.id)) ordered.push(r.id);
  await db.transaction(async (tx) => {
    for (let i = 0; i < ordered.length; i++) {
      await tx
        .update(boardTemplateStatuses)
        .set({ position: i })
        .where(
          and(
            eq(boardTemplateStatuses.id, ordered[i]),
            eq(boardTemplateStatuses.templateId, templateId),
          ),
        );
    }
  });
  rev(templateId);
}

export async function deleteTemplateStatusAction(
  templateId: number,
  statusId: number,
): Promise<void> {
  await requireTemplateManager();
  await db
    .delete(boardTemplateStatuses)
    .where(
      and(
        eq(boardTemplateStatuses.id, statusId),
        eq(boardTemplateStatuses.templateId, templateId),
      ),
    );
  rev(templateId);
}

/** Template inkl. Spalten duplizieren (Name „… - copy", bei Bedarf nummeriert). */
export async function duplicateTemplateAction(templateId: number): Promise<void> {
  await requireTemplateManager();
  const [orig] = await db
    .select()
    .from(boardTemplates)
    .where(eq(boardTemplates.id, templateId))
    .limit(1);
  if (!orig) return;

  // Eindeutigen Namen finden (boardTemplates.name ist UNIQUE).
  const existing = new Set(
    (await db.select({ name: boardTemplates.name }).from(boardTemplates)).map(
      (r) => r.name,
    ),
  );
  let name = `${orig.name} - copy`;
  for (let i = 2; existing.has(name); i++) name = `${orig.name} - copy ${i}`;

  const cols = await db
    .select()
    .from(boardTemplateStatuses)
    .where(eq(boardTemplateStatuses.templateId, templateId))
    .orderBy(asc(boardTemplateStatuses.position));

  let newId: number | undefined;
  await db.transaction(async (tx) => {
    const [tpl] = await tx
      .insert(boardTemplates)
      .values({ name: name.slice(0, 120), description: orig.description })
      .returning({ id: boardTemplates.id });
    newId = tpl.id;
    if (cols.length) {
      await tx.insert(boardTemplateStatuses).values(
        cols.map((c) => ({
          templateId: tpl.id,
          name: c.name,
          position: c.position,
          isArchiveTrigger: c.isArchiveTrigger,
        })),
      );
    }
  });
  revalidatePath("/vorlagen/boards");
  if (newId) redirect(`/vorlagen/boards/${newId}`);
}
