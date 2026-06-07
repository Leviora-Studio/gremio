// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { financeTemplates, financeTemplateItems } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";
import { parseEuroToCents } from "@/lib/money";

export type State = { error?: string; success?: string };

export async function createFinanceTemplateAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name erforderlich." };
  const description = String(formData.get("description") ?? "").slice(0, 500);
  const [t] = await db
    .insert(financeTemplates)
    .values({ name: name.slice(0, 120), description: description || null })
    .returning();
  redirect(`/vorlagen/finanzen/${t.id}`);
}

export async function renameFinanceTemplateAction(
  id: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name erforderlich." };
  const description = String(formData.get("description") ?? "").slice(0, 500);
  await db
    .update(financeTemplates)
    .set({ name: name.slice(0, 120), description: description || null })
    .where(eq(financeTemplates.id, id));
  revalidatePath(`/vorlagen/finanzen/${id}`);
  return { success: "Gespeichert." };
}

export async function deleteFinanceTemplateAction(id: number): Promise<void> {
  await requireTemplateManager();
  await db.delete(financeTemplates).where(eq(financeTemplates.id, id));
  revalidatePath("/vorlagen/finanzen");
}

/** Finanz-Template inkl. Haushaltsplan-Positionen duplizieren (Name „… - copy"). */
export async function duplicateFinanceTemplateAction(id: number): Promise<void> {
  await requireTemplateManager();
  const [orig] = await db
    .select()
    .from(financeTemplates)
    .where(eq(financeTemplates.id, id))
    .limit(1);
  if (!orig) return;

  const items = await db
    .select()
    .from(financeTemplateItems)
    .where(eq(financeTemplateItems.templateId, id))
    .orderBy(asc(financeTemplateItems.position));

  let newId: number | undefined;
  await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(financeTemplates)
      .values({
        name: `${orig.name} - copy`.slice(0, 120),
        description: orig.description,
      })
      .returning({ id: financeTemplates.id });
    newId = t.id;

    // Erst die Oberpunkte (parentId=null) anlegen und alte→neue ID merken,
    // dann die Unterpunkte mit umgehängter parentId.
    const idMap = new Map<number, number>();
    for (const it of items.filter((i) => i.parentId === null)) {
      const [ins] = await tx
        .insert(financeTemplateItems)
        .values({
          templateId: t.id,
          parentId: null,
          kind: it.kind,
          haushaltstitel: it.haushaltstitel,
          title: it.title,
          plannedAmount: it.plannedAmount,
          position: it.position,
        })
        .returning({ id: financeTemplateItems.id });
      idMap.set(it.id, ins.id);
    }
    for (const it of items.filter((i) => i.parentId !== null)) {
      const newParent =
        it.parentId !== null ? idMap.get(it.parentId) ?? null : null;
      await tx.insert(financeTemplateItems).values({
        templateId: t.id,
        parentId: newParent,
        kind: it.kind,
        haushaltstitel: it.haushaltstitel,
        title: it.title,
        plannedAmount: it.plannedAmount,
        position: it.position,
      });
    }
  });
  revalidatePath("/vorlagen/finanzen");
  if (newId) redirect(`/vorlagen/finanzen/${newId}`);
}

export async function addFinanceTemplateItemAction(
  templateId: number,
  parentId: number | null,
  kind: "income" | "expense" = "expense",
): Promise<void> {
  await requireTemplateManager();
  let effectiveKind: "income" | "expense" = kind === "income" ? "income" : "expense";
  // Oberpunkt muss zu DIESEM Template gehören (kein board-/templateübergreifendes
  // parentId über manipuliertes FormData); Unterpunkte erben das Kind.
  if (parentId) {
    const [p] = await db
      .select({
        t: financeTemplateItems.templateId,
        kind: financeTemplateItems.kind,
      })
      .from(financeTemplateItems)
      .where(eq(financeTemplateItems.id, parentId))
      .limit(1);
    if (!p || p.t !== templateId) return;
    effectiveKind = p.kind;
  }
  const [row] = await db
    .select({ m: max(financeTemplateItems.position) })
    .from(financeTemplateItems)
    .where(eq(financeTemplateItems.templateId, templateId));
  await db.insert(financeTemplateItems).values({
    templateId,
    parentId: parentId ?? null,
    kind: effectiveKind,
    position: (row?.m ?? -1) + 1,
  });
  revalidatePath(`/vorlagen/finanzen/${templateId}`);
}

async function templateOfItem(itemId: number): Promise<number | null> {
  const [it] = await db
    .select({ t: financeTemplateItems.templateId })
    .from(financeTemplateItems)
    .where(eq(financeTemplateItems.id, itemId))
    .limit(1);
  return it?.t ?? null;
}

export async function editFinanceTemplateItemAction(
  itemId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  const tId = await templateOfItem(itemId);
  if (!tId) return { error: "Position nicht gefunden." };
  const rawAmount = String(formData.get("plannedAmount") ?? "").trim();
  const plannedAmount = parseEuroToCents(rawAmount);
  if (rawAmount !== "" && plannedAmount === null) {
    return { error: "Betrag ungültig oder zu groß (max. 20.000.000,00 €)." };
  }
  await db
    .update(financeTemplateItems)
    .set({
      haushaltstitel: String(formData.get("haushaltstitel") ?? "").slice(0, 60),
      title: String(formData.get("title") ?? "").slice(0, 200),
      plannedAmount,
    })
    .where(eq(financeTemplateItems.id, itemId));
  revalidatePath(`/vorlagen/finanzen/${tId}`);
  return { success: "Gespeichert." };
}

export async function deleteFinanceTemplateItemAction(
  itemId: number,
): Promise<void> {
  await requireTemplateManager();
  const tId = await templateOfItem(itemId);
  await db.delete(financeTemplateItems).where(eq(financeTemplateItems.id, itemId));
  if (tId) revalidatePath(`/vorlagen/finanzen/${tId}`);
}
