import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, cards, cardBudgetPositions, type Card } from "@/lib/db/schema";
import { AMOUNT_KEYS, BUDGET_FIELDS, budgetPositionsInputSchema, budgetTotals, budgetTitles, canReturnToSingle, type BudgetPosition } from "@/lib/card-budget";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BudgetValidationError extends Error {}

export async function loadBudgetPositions(cardId: number, tx: Tx | typeof db = db) {
  return tx.select().from(cardBudgetPositions).where(eq(cardBudgetPositions.cardId, cardId)).orderBy(asc(cardBudgetPositions.position));
}

/** Revisions and position rows must describe the same committed budget. */
export async function loadBudgetSnapshot(cardId: number) {
  return db.transaction(async tx => {
    const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
    if (!card) throw new BudgetValidationError("Karte nicht gefunden.");
    return { card, rows: await loadBudgetPositions(cardId, tx) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Batch display-only projection. Never use these strings for allocations. */
export async function budgetDisplayForCards(cardIds: number[]) {
  const result = new Map<number, { budgetTitle: string | null; accountName: string }>();
  if (!cardIds.length) return result;
  const rows = await db.select({ cardId: cardBudgetPositions.cardId, budgetTitle: cardBudgetPositions.budgetTitle, accountName: accounts.name }).from(cardBudgetPositions).innerJoin(accounts, eq(accounts.id, cardBudgetPositions.accountId)).where(inArray(cardBudgetPositions.cardId, cardIds)).orderBy(asc(cardBudgetPositions.position));
  const grouped = new Map<number, typeof rows>();
  for (const row of rows) { const group = grouped.get(row.cardId) ?? []; group.push(row); grouped.set(row.cardId, group); }
  for (const [id, group] of grouped) result.set(id, { budgetTitle: budgetTitles(group), accountName: [...new Set(group.map((r) => r.accountName))].join(", ") });
  return result;
}

/** Call inside the same transaction as the card update, never before it. */
export async function guardBudgetCardUpdate(tx: Tx, cardId: number, update: Partial<typeof cards.$inferInsert>) {
  const [fresh] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!fresh) throw new BudgetValidationError("Karte nicht gefunden.");
  if (Object.keys(BUDGET_FIELDS).some((key) => key in update)) {
    if (fresh.budgetMode === "positions") throw new BudgetValidationError("Beträge, Haushaltstitel und Konten werden über die Haushaltspositionen bearbeitet; Gesamtsummen sind automatisch berechnet.");
    update.budgetRevision = fresh.budgetRevision + 1;
  }
  return fresh;
}

export async function writeBudgetPositions(tx: Tx, card: Card, input: unknown, revision: number, visible: Set<string>) {
  if (revision !== card.budgetRevision) throw new BudgetValidationError("Die Haushaltsdaten wurden inzwischen geändert. Bitte vor dem Speichern neu laden; dein Entwurf bleibt erhalten.");
  const parsed = budgetPositionsInputSchema.safeParse(input);
  if (!parsed.success) throw new BudgetValidationError(parsed.error.issues[0]?.message ?? "Ungültige Positionen. Jede Position benötigt ein Konto.");
  if (!visible.has("budget_title") || !visible.has("account")) throw new BudgetValidationError("Haushaltstitel und Konto müssen auf dem Board aktiviert sein.");
  const old = await loadBudgetPositions(card.id, tx);
  const existing = new Map(old.map((r) => [r.id, r]));
  const rows: BudgetPosition[] = parsed.data.map((row, index) => {
    const before = existing.get(row.id) ?? (card.budgetMode === "single" && index === 0 ? card : null);
    return { ...row, ...Object.fromEntries(AMOUNT_KEYS.map((key) => [key, row[key] === undefined ? before?.[key] ?? null : row[key]])) } as BudgetPosition;
  });
  // IDs are globally unique. Reject copied IDs from another card as validation
  // errors, rather than exposing a constraint failure after deleting old rows.
  const usedIds = await tx.select({ cardId: cardBudgetPositions.cardId }).from(cardBudgetPositions)
    .where(inArray(cardBudgetPositions.id, rows.map((row) => row.id)));
  if (usedIds.some((row) => row.cardId !== card.id))
    throw new BudgetValidationError("Eine Positions-ID wird bereits verwendet. Für neue Positionen bitte neue UUIDs vergeben.");
  // Hidden fields must not be writable indirectly through row replacement.
  for (const row of rows) {
    const before = existing.get(row.id) ?? (card.budgetMode === "single" && row === rows[0] ? card : null);
    for (const [key, field] of Object.entries(BUDGET_FIELDS) as [keyof typeof BUDGET_FIELDS, string][]) {
      if (!visible.has(field) && row[key] !== (before?.[key] ?? null)) throw new BudgetValidationError(`Feld '${field}' ist auf diesem Board nicht aktiviert.`);
    }
  }
  for (const row of old.filter((r) => !rows.some((n) => n.id === r.id))) {
    if (Object.entries(BUDGET_FIELDS).some(([key, field]) => !visible.has(field) && row[key as keyof BudgetPosition] != null)) throw new BudgetValidationError("Position enthält ausgeblendete Felder und kann nicht entfernt werden.");
  }
  // The editor prefills position 1 from the card, but visible fields may already
  // be edited before the first save. Revision and hidden-field checks above
  // still protect concurrent changes and values the user cannot edit.
  const ids = [...new Set(rows.map((r) => r.accountId))];
  const valid = await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, ids)).for("key share");
  if (valid.length !== ids.length) throw new BudgetValidationError("Ein ausgewähltes Konto existiert nicht mehr. Bitte für jede Position ein gültiges Konto wählen.");
  let totals;
  try { totals = budgetTotals(rows); } catch (e) { throw new BudgetValidationError((e as Error).message); }
  const single = canReturnToSingle(rows);
  await tx.delete(cardBudgetPositions).where(eq(cardBudgetPositions.cardId, card.id));
  if (!single) await tx.insert(cardBudgetPositions).values(rows.map((r, position) => ({ ...r, cardId: card.id, position })));
  await tx.update(cards).set({ ...totals, budgetMode: single ? "single" : "positions", budgetTitle: single ? rows[0].budgetTitle : null, accountId: single ? rows[0].accountId : null, budgetRevision: card.budgetRevision + 1, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { rows: single ? [] : rows, single, totals, revision: card.budgetRevision + 1 };
}
