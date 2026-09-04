import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { BudgetPositionsEditor } from "../../components/antrag/BudgetPositionsEditor";
import { PublicUploadForm } from "../../components/PublicUploadForm";
import { PublicSubmitForm } from "../../components/PublicSubmitForm";
import { PublicUploadScope } from "../../components/PublicUploadScope";
import { PublicGate } from "../../components/PublicGate";
import { ArchiveTriggerForm } from "../../components/board/ArchiveTriggerForm";
import { AntraegeTable } from "../../components/finance/AntraegeTable";
import type { BudgetPosition } from "../../lib/card-budget";
function Fixture() {
  const [active, setActive] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const [loadedBudget, setLoadedBudget] = useState<{ rows: BudgetPosition[]; revision: number }>({ rows: [], revision: 0 });
  const [budgetMount, setBudgetMount] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => setLoadedBudget((event as CustomEvent).detail);
    window.addEventListener("budget-saved", refresh);
    return () => window.removeEventListener("budget-saved", refresh);
  }, []);
  const [, render] = useState(0);
  return <main className="mx-auto max-w-4xl space-y-8 p-4">
    <h1 className="text-xl font-bold">Uploads und Haushaltspositionen</h1>
    <section className="card p-4"><h2 className="mb-3 font-semibold">Trigger-Spalten</h2><ArchiveTriggerForm initial={[1]} statuses={[1,2,3,4].map(id => ({ id, name: `Spalte ${id}` }))} action={async (_s, data) => { (window as any).triggers = data.getAll("statusIds"); return { success: "Trigger gespeichert" }; }} /></section>
    <PublicUploadScope>
      <section aria-label="Allgemeine Dateien" className="card space-y-3 p-4"><h2 className="font-semibold">Dateien einreichen</h2><PublicGate allowed className="space-y-4"><p className="text-sm text-slate-500">Hier kannst du allgemeine Dateien und Nachträge als PDF hochladen.</p><PublicUploadForm token="test" /><PublicSubmitForm token="test" purpose="resubmission" label="Nachreichung einreichen" /></PublicGate></section>
      <PublicGate allowed={allowed} className="card space-y-4 p-4"><h2 className="font-semibold">Quittung einreichen</h2><PublicUploadForm token="test" purpose="receipt" /><PublicSubmitForm token="test" purpose="receipt" label="Quittung einreichen" /></PublicGate>
    </PublicUploadScope>
    <div className="flex gap-2"><button onClick={() => render(n => n+1)}>Live-Aktualisierung</button><button onClick={() => setAllowed(false)}>Gate sperren</button></div>
    <button onClick={() => { setLoadedBudget({ rows: (window as any).budgetSaves.at(-1).map((row: BudgetPosition, position: number) => ({ ...row, cardId: 1, position })), revision: (window as any).budgetSaves.length }); setBudgetMount(n => n + 1); }}>Gespeicherte Positionen neu laden</button>
    <section aria-label="Budget" className="card p-4"><BudgetPositionsEditor key={budgetMount} cardId={1} initial={loadedBudget.rows} revision={loadedBudget.revision} accounts={[{ id: 1, name: "Konto A" }, { id: 2, name: "Konto B" }]} visible={["budget_title", "account", "requested_amount", "approved_amount", "actual_amount"]} active={active} onActive={setActive} beforeStart={async () => true} /></section>
    <AntraegeTable rows={[{ id: 1, number: "A01", title: "Zwei Positionen", applicant: "Test", budgetTitle: "12345, 12344", decisionRef: null, instructionDate: null, transferDate: null, approvedAmount: 35000, actualAmount: 31000, accountId: null }]} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
