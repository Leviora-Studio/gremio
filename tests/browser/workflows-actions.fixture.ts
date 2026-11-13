import { budgetTotals, canReturnToSingle, budgetPositionsInputSchema } from "../../lib/card-budget";
const w = window as any;
w.uploads = []; w.submissions = []; w.budgetSaves = [];
export async function addPublicFileAction(_token: string, _state: unknown, data: FormData) {
  const file = data.get("file") as File;
  w.uploads.push({ name: file.name, purpose: data.get("purpose") });
  await new Promise(resolve => setTimeout(resolve, 250));
  if (file.name === "fail.pdf" && w.uploads.filter((f: any) => f.name === file.name).length === 1) return { error: "Testfehler für diese Datei" };
  return { success: `Hinzugefügt: ${file.name}` };
}
export async function submitPublicAction(_token: string, _state: unknown, data: FormData) { w.submissions.push(data.get("purpose")); return { success: "Eingereicht" }; }
export async function getBudgetSnapshotAction() { return { card: { budgetTitle: "12345", accountId: null, requestedAmount: 20000, approvedAmount: 15000, actualAmount: 13000 }, revision: 0, rows: [], defaultAccountId: 2 }; }
export async function saveBudgetPositionsAction(_id: number, rows: any[], revision: number) {
  await new Promise(resolve => setTimeout(resolve, 100));
  const parsed = budgetPositionsInputSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  w.budgetSaves.push(structuredClone(rows));
  // Revalidate/SSE echoes saved cents into the still-mounted editor.
  setTimeout(() => window.dispatchEvent(new CustomEvent("budget-saved", { detail: {
    rows: rows.map((row, position) => ({ ...row, cardId: _id, position })), revision: revision + 1,
  } })), 0);
  return { ok: true, rows, revision: revision + 1, totals: budgetTotals(rows), single: canReturnToSingle(rows) };
}

export async function saveBudgetPlanAction(_id: number, revision: number, input: unknown) {
  const { parseBudgetPlan } = await import("../../lib/card-budget-plan");
  try {
    const allocations = parseBudgetPlan(input);
    if (w.planFailNext) { w.planFailNext = false; return { error: "Einplanung wurde zwischenzeitlich geändert. Bitte neu laden." }; }
    w.savedPlan = allocations;
    return { revision: revision + 1 };
  } catch (error) { return { error: (error as Error).message }; }
}
