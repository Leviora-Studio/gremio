// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

// Reine Label-/Farb-Helfer für den Vorgangs-Status (client- und serverseitig).

export const LOAN_STAGE_LABEL: Record<string, string> = {
  requested: "Anfrage eingegangen",
  contract_provided: "Vertrag bereitgestellt",
  contract_signed: "Vertrag unterschrieben",
  active: "läuft",
  returned: "zurückgegeben",
  rejected: "abgelehnt",
  withdrawn: "zurückgezogen",
};

export function loanStageLabel(status: string): string {
  return LOAN_STAGE_LABEL[status] ?? status;
}

export function loanStageClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-amber-50 text-amber-700";
    case "returned":
      return "bg-slate-100 text-slate-500";
    case "rejected":
    case "withdrawn":
      return "bg-slate-100 text-slate-400";
    default:
      return "bg-blue-50 text-blue-700";
  }
}
