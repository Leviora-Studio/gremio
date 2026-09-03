// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { protocolTemplates } from "@/lib/db/schema";
import { requireTemplateManager } from "@/lib/auth";
import { validateProtocolTemplate } from "@/lib/protocol-markdown";

export type State = { error?: string; success?: string };

function values(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const markdown = String(formData.get("markdown") ?? "");
  if (!name) throw new Error("Name erforderlich.");
  if (!markdown.trim()) throw new Error("Markdown-Inhalt erforderlich.");
  validateProtocolTemplate(markdown);
  return { name: name.slice(0, 120), description, markdown };
}

export async function createProtocolTemplateAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  try {
    await db.insert(protocolTemplates).values(values(formData));
    revalidatePath("/vorlagen/protokolle");
    return { success: "Protokollvorlage angelegt." };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateProtocolTemplateAction(
  id: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireTemplateManager();
  try {
    await db.update(protocolTemplates).set(values(formData)).where(eq(protocolTemplates.id, id));
    revalidatePath("/vorlagen/protokolle");
    return { success: "Protokollvorlage gespeichert." };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function deleteProtocolTemplateAction(id: number): Promise<void> {
  await requireTemplateManager();
  await db.delete(protocolTemplates).where(eq(protocolTemplates.id, id));
  revalidatePath("/vorlagen/protokolle");
}
