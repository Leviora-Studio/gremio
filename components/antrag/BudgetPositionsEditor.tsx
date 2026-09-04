"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/Select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AMOUNT_KEYS, BUDGET_FIELDS, budgetTotals, editableBudgetPosition, type BudgetPosition } from "@/lib/card-budget";
import { centsToInput, formatCents, parseEuroToCents } from "@/lib/money";
import { getBudgetSnapshotAction, saveBudgetPositionsAction } from "@/app/intern/card/[id]/actions";

type Draft = Omit<BudgetPosition, "accountId" | typeof AMOUNT_KEYS[number]> & { accountId: number | null; requestedAmount: string; approvedAmount: string; actualAmount: string };
const draft = (row: BudgetPosition): Draft => ({ ...editableBudgetPosition(row), requestedAmount: centsToInput(row.requestedAmount), approvedAmount: centsToInput(row.approvedAmount), actualAmount: centsToInput(row.actualAmount) });
const labels = { requestedAmount: "Beantragter Betrag", approvedAmount: "Genehmigter Betrag", actualAmount: "Tatsächliche Ausgaben" };
export function BudgetPositionsEditor({ cardId, initial, revision: initialRevision, accounts, visible, active, onActive, beforeStart, onDirtyChange }: {
  cardId: number; initial: BudgetPosition[]; revision: number; accounts: { id: number; name: string }[]; visible: string[];
  active: boolean; onActive: (active: boolean, single?: BudgetPosition) => void; beforeStart: () => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(initial.map(draft));
  const current = useRef(rows);
  const revision = useRef(initialRevision);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const defaultAccount = useRef<number | null>(null);
  useEffect(() => {
    if (dirty.current || saving.current || initialRevision < revision.current) return;
    const previous = new Map(current.current.map(row => [row.id, row]));
    current.current = initial.map(row => {
      const next = draft(row);
      const before = previous.get(row.id);
      if (before) for (const key of AMOUNT_KEYS) {
        // Saved cents are not a new input value: retain literal text and caret
        // on autosave echoes, even if another field/position changed remotely.
        const unchanged = before[key].trim() === ""
          ? row[key] == null
          : row[key] != null && parseEuroToCents(before[key]) === row[key];
        if (unchanged) next[key] = before[key];
      }
      return next;
    });
    setRows(current.current);
    revision.current = initialRevision;
  }, [initial, initialRevision]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, []);
  function parse(input: Draft[]): BudgetPosition[] {
    return input.map((r, i) => {
      if (!r.accountId) throw new Error(`Position ${i + 1}: Bitte ein Konto auswählen. Noch nicht gespeichert.`);
      const amounts = Object.fromEntries(AMOUNT_KEYS.map((k) => {
        const value = r[k].trim() ? parseEuroToCents(r[k]) : null;
        if (r[k].trim() && value == null) throw new Error(`Position ${i + 1}: ${labels[k]} ist ungültig.`);
        return [k, value];
      })) as Pick<BudgetPosition, typeof AMOUNT_KEYS[number]>;
      return { ...r, ...amounts, accountId: r.accountId };
    });
  }
  async function save() {
    if (saving.current || !dirty.current) return;
    const snapshot = current.current;
    let input;
    try { input = parse(snapshot); budgetTotals(input); } catch (e) { setError(true); setMessage((e as Error).message); return; }
    saving.current = true; setError(false); setMessage("Speichert …");
    try {
      const payload = input.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !(key in BUDGET_FIELDS) || visible.includes(BUDGET_FIELDS[key as keyof typeof BUDGET_FIELDS]))));
      const result = await saveBudgetPositionsAction(cardId, payload, revision.current);
      if (!result.ok) { setError(true); setMessage(result.error); return; }
      revision.current = result.revision;
      if (current.current === snapshot) {
        dirty.current = false; onDirtyChange?.(false); setMessage("Gespeichert ✓");
        if (result.single) { onActive(false, input[0]); router.refresh(); }
      }
    } catch { setError(true); setMessage("Netzwerkfehler. Entwurf bleibt erhalten."); }
    finally { saving.current = false; }
    if (dirty.current && current.current !== snapshot) schedule();
  }
  function schedule() { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 700); }
  function change(next: Draft[]) { current.current = next; setRows(next); dirty.current = true; onDirtyChange?.(true); setError(false); setMessage("Noch nicht gespeichert …"); schedule(); }
  function add() { change([...current.current, { id: crypto.randomUUID(), budgetTitle: null, description: null, accountId: defaultAccount.current, requestedAmount: "", approvedAmount: "", actualAmount: "" }]); }
  async function start() {
    if (starting) return;
    setStarting(true);
    try {
    if (!(await beforeStart())) return;
    const data = await getBudgetSnapshotAction(cardId);
    revision.current = data.revision; defaultAccount.current = data.defaultAccountId;
    const first: Draft = { id: crypto.randomUUID(), budgetTitle: data.card.budgetTitle, description: null, accountId: data.card.accountId, requestedAmount: centsToInput(data.card.requestedAmount), approvedAmount: centsToInput(data.card.approvedAmount), actualAmount: centsToInput(data.card.actualAmount) };
    current.current = data.rows.length ? data.rows.map(draft) : [first];
    onActive(true); add();
    } catch { setError(true); setMessage("Haushaltsdaten konnten nicht geladen werden. Bitte erneut versuchen."); }
    finally { setStarting(false); }
  }
  const canEdit = ["budget_title", "account"].every((k) => visible.includes(k));
  let totals: ReturnType<typeof budgetTotals> | null = null;
  try { totals = budgetTotals(parse(rows)); } catch { /* incomplete draft */ }
  if (!active) return canEdit ? <div className="space-y-2 sm:col-span-2"><button type="button" disabled={starting} className="text-sm text-brand-700 hover:underline" onClick={() => void start()}>Weiteren Haushaltstitel hinzufügen</button>{error && <p className="text-sm text-red-600">{message}</p>}</div> : null;
  return <details open className="collapsible min-w-0 sm:col-span-2">
    <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-3 hover:bg-slate-50">
      <span className="flex items-center gap-2 font-semibold">
        <svg className="chev h-5 w-5 shrink-0 text-slate-400 transition-transform" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Haushaltspositionen
      </span>
      <span role="status" className={`text-sm ${error ? "text-red-600" : "text-slate-500"}`}>{message || "Automatisches Speichern"}</span>
    </summary>
    <div className="mt-3 space-y-4">
    {!canEdit && <p className="text-sm text-slate-500">Zum Bearbeiten der Positionen müssen Haushaltstitel und Konto am Board aktiviert sein.</p>}
    {rows.map((row, i) => <fieldset key={row.id} disabled={!canEdit} className="min-w-0 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium">Position {i + 1}</legend>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>label]:min-w-0">
        {visible.includes("budget_title") && <><label className="text-sm">Haushaltstitel<input className="input mt-1" value={row.budgetTitle ?? ""} maxLength={60} onChange={(e) => change(rows.map((r) => r.id === row.id ? { ...r, budgetTitle: e.target.value || null } : r))} /></label>
        <label className="text-sm">Bezeichnung<input className="input mt-1" value={row.description ?? ""} maxLength={1000} onChange={(e) => change(rows.map((r) => r.id === row.id ? { ...r, description: e.target.value || null } : r))} /></label></>}
        {visible.includes("account") && <label className="text-sm">Konto *<Select ariaLabel={`Konto Position ${i + 1}`} value={row.accountId ? String(row.accountId) : ""} onChange={(v) => change(rows.map((r) => r.id === row.id ? { ...r, accountId: v ? Number(v) : null } : r))} options={[{ value: "", label: "Bitte auswählen" }, ...accounts.map((a) => ({ value: String(a.id), label: a.name }))]} />{!row.accountId && <span className="text-xs text-red-600">Konto erforderlich – noch nicht gespeichert</span>}</label>}
        {AMOUNT_KEYS.filter((k) => visible.includes(BUDGET_FIELDS[k])).map((k) => <label key={k} className="text-sm">{labels[k]} (€)<input className="input mt-1" inputMode="decimal" value={row[k]} onChange={(e) => change(rows.map((r) => r.id === row.id ? { ...r, [k]: e.target.value } : r))} /></label>)}
      </div>
      {rows.length > 1 && <button type="button" className="mt-3 text-sm text-red-600 hover:underline" onClick={() => setRemoveId(row.id)}>Position entfernen</button>}
    </fieldset>)}
    <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-3">{AMOUNT_KEYS.filter((k) => visible.includes(BUDGET_FIELDS[k])).map((k) => <div key={k}><div className="text-xs text-slate-500">{labels[k]} gesamt</div><div>{totals ? formatCents(totals[k]) || "Noch nicht eingetragen" : "Entwurf unvollständig"}</div></div>)}<p className="text-xs text-slate-500 sm:col-span-3">Automatisch aus allen Positionen berechnet.</p></div>
    {canEdit && <button type="button" className="btn-secondary btn-sm" onClick={add}>Weiteren Haushaltstitel hinzufügen</button>}
    {error && <button type="button" className="ml-3 text-sm text-brand-700" onClick={() => void save()}>Erneut speichern</button>}
    <ConfirmDialog open={removeId != null} title="Position entfernen" message="Diese Haushaltsposition samt Kontozuordnung und Beträgen entfernen? Die Gesamtsummen werden neu berechnet." confirmLabel="Entfernen" onClose={() => setRemoveId(null)} onConfirm={() => { change(rows.filter((r) => r.id !== removeId)); setRemoveId(null); }} />
    </div>
  </details>;
}
