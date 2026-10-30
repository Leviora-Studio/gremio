// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { createRoot } from "react-dom/client";
import { FinancePlanConfirmation } from "../../components/finance/FinancePlanConfirmation";
import { PlanItemRow } from "../../components/finance/PlanItemRow";

Object.assign(window, { savedPlans: [], failNextSave: false });
const context = window as unknown as { savedPlans: Record<string, FormDataEntryValue>[]; failNextSave: boolean };
createRoot(document.getElementById("root")!).render(
  <FinancePlanConfirmation boardId={42}>
    <PlanItemRow item={{ id: 1, haushaltstitel: "1100", title: "Beispielposition", plannedAmount: "500,00" }}
      editAction={async (_previous, data) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (context.failNextSave) { context.failNextSave = false; throw new Error("Synthetic network failure"); }
        context.savedPlans.push(Object.fromEntries(data));
        return { success: "Gespeichert." };
      }} deleteAction={async () => {}} />
  </FinancePlanConfirmation>,
);
