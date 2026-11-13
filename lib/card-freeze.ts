// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";

export class CardFrozenError extends Error {
  constructor() { super("Diese Karte ist dauerhaft gesperrt. Nur Spaltenwechsel und neue Quittungen sind zulässig."); }
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Serialize the permission to mutate children with irreversible card locking. */
export async function requireMutableCard(tx: Tx, cardId: number) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!card) throw new Error("Karte nicht verfügbar.");
  if (card.lockedAt) throw new CardFrozenError();
  return card;
}
