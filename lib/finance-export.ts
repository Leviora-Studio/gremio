// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { type FinanceData } from "@/lib/finance-data";
import { type Row, type Table } from "@/lib/export";

const eur = (cents: number | null | undefined) =>
  cents == null ? null : cents / 100;

// Einrückung für Unterpunkte (in beiden Formaten als führende Leerzeichen).
const IND = "    ";

export const VIEW_TITLES: Record<string, string> = {
  plan: "Haushaltsplan",
  live: "Live-Ausgaben",
  actual: "Tatsächliche Ausgaben",
  antraege: "Anträge nach Haushaltstitel",
  antraege_nr: "Anträge nach Antragsnummer",
};

const HT = { header: "Haushaltstitel", width: 1.5 };
const dash = (s: string | null | undefined) => (s && s.trim() ? s : "—");

// View 1: Haushaltsplan — Einnahmen/Ausgaben getrennt, Abschnitts-Summen,
// Unterpunkte eingerückt, abschließender Saldo. (Offizielles Format.)
function planTable(data: FinanceData): Table {
  const sum = (tops: FinanceData["incomeTops"]) =>
    tops.reduce((s, t) => s + (t.plannedAmount ?? 0), 0);
  const incomeSum = sum(data.incomeTops);
  const expenseSum = sum(data.expenseTops);

  const rows: Row[] = [];
  const section = (label: string, tops: FinanceData["incomeTops"], total: number) => {
    rows.push({ cells: ["", label, eur(total)], style: "section" });
    for (const top of tops) {
      rows.push({
        cells: [top.haushaltstitel, top.title || "(ohne Bezeichnung)", eur(top.plannedAmount)],
        style: "top",
      });
      for (const k of data.childrenOf(top.id)) {
        rows.push({
          cells: [k.haushaltstitel, IND + (k.title || "(ohne Bezeichnung)"), eur(k.plannedAmount)],
          style: "sub",
        });
      }
    }
  };
  section("Einnahmen", data.incomeTops, incomeSum);
  section("Ausgaben", data.expenseTops, expenseSum);
  rows.push({
    cells: ["", "Saldo (Einnahmen - Ausgaben)", eur(incomeSum - expenseSum)],
    style: "total",
  });

  return {
    title: "Haushaltsplan",
    columns: [HT, { header: "Bezeichnung", width: 6 }, { header: "Geplant (€)", width: 1.8, money: true }],
    rows,
  };
}

// View 2/3: Live- / Tatsächliche Ausgaben — Ausgaben-Rollup gegen den Plan.
function expenseTable(title: string, view: FinanceData["live"]): Table {
  let planTop = 0;
  const body: Row[] = [];
  for (const top of view.rows) {
    planTop += top.planned ?? 0;
    body.push({
      cells: [
        top.haushaltstitel,
        top.title || "(ohne Bezeichnung)",
        eur(top.planned),
        eur(top.spent),
        eur(top.planned != null ? top.planned - top.spent : null),
      ],
      style: "top",
    });
    for (const k of top.children) {
      body.push({
        cells: [
          k.haushaltstitel,
          IND + (k.title || "(ohne Bezeichnung)"),
          eur(k.planned),
          eur(k.spent),
          eur(k.planned != null ? k.planned - k.spent : null),
        ],
        style: "sub",
      });
    }
  }

  let unmatchedSpent = 0;
  const umRows: Row[] = [];
  for (const u of view.unmatched) {
    unmatchedSpent += u.spent;
    umRows.push({ cells: ["", IND + u.title, null, eur(u.spent), null], style: "sub" });
  }
  // Dedupliziert (jeder Haushaltstitel einmal) — nicht die Oberpunkte aufsummieren.
  const totalSpent = view.spentTotal + unmatchedSpent;

  const rows: Row[] = [
    { cells: ["", "Ausgaben"], style: "section" },
    ...body,
    ...(umRows.length
      ? [
          { cells: ["", "Ohne Haushaltstitel", null, eur(unmatchedSpent), null], style: "section" } as Row,
          ...umRows,
        ]
      : []),
    {
      cells: ["", "Summe", eur(planTop), eur(totalSpent), eur(planTop - totalSpent)],
      style: "total",
    },
  ];

  return {
    title,
    columns: [
      HT,
      { header: "Bezeichnung", width: 4.6 },
      { header: "Geplant (€)", width: 1.7, money: true },
      { header: "Ausgegeben (€)", width: 1.7, money: true },
      { header: "Rest (€)", width: 1.7, money: true },
    ],
    rows,
  };
}

// View 4a: Anträge — gruppiert nach Haushaltstitel mit Zwischensummen.
function antraegeTable(data: FinanceData): Table {
  const groups = new Map<string, FinanceData["cardRows"]>();
  for (const c of data.cardRows) {
    const key = c.budgetTitle ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, "de"));

  const rows: Row[] = [];
  let totApproved = 0;
  let totActual = 0;
  for (const key of keys) {
    const cards = groups.get(key)!;
    const gApproved = cards.reduce((s, c) => s + (c.approvedAmount ?? 0), 0);
    const gActual = cards.reduce((s, c) => s + (c.actualAmount ?? 0), 0);
    totApproved += gApproved;
    totActual += gActual;
    rows.push({
      cells: [
        "",
        key || "(ohne Haushaltstitel)",
        `${cards.length} ${cards.length === 1 ? "Antrag" : "Anträge"}`,
        "",
        "",
        "",
        "",
        eur(gApproved),
        eur(gActual),
      ],
      style: "top",
    });
    for (const c of cards) {
      rows.push({
        cells: [
          c.number ?? "—",
          "",
          IND + c.title,
          c.applicant || "—",
          dash(c.decisionRef),
          dash(c.instructionDate),
          dash(c.transferDate),
          eur(c.approvedAmount),
          eur(c.actualAmount),
        ],
        style: "sub",
      });
    }
  }
  rows.push({
    cells: ["", "", "Summe", "", "", "", "", eur(totApproved), eur(totActual)],
    style: "total",
  });

  return {
    title: "Anträge nach Haushaltstitel",
    columns: [
      { header: "Antragsnr.", width: 1.5 },
      HT,
      { header: "Titel", width: 3.2 },
      { header: "Antragsteller", width: 2.4 },
      { header: "Beschlussreferenz", width: 2.6 },
      { header: "Anweisung", width: 1.4 },
      { header: "Überweisung", width: 1.4 },
      { header: "Genehmigt (€)", width: 1.6, money: true },
      { header: "Getätigt (€)", width: 1.6, money: true },
    ],
    rows,
  };
}

// View 4b: Anträge — flache Liste, sortiert nach Antragsnummer (leere ans Ende).
function antraegeByNumberTable(data: FinanceData): Table {
  const sorted = [...data.cardRows].sort((a, b) => {
    const an = (a.number ?? "").trim();
    const bn = (b.number ?? "").trim();
    if (!an || !bn) return an === bn ? 0 : an ? -1 : 1; // leere Nummern ans Ende
    return an.localeCompare(bn, "de", { numeric: true });
  });

  const rows: Row[] = [];
  let totApproved = 0;
  let totActual = 0;
  for (const c of sorted) {
    totApproved += c.approvedAmount ?? 0;
    totActual += c.actualAmount ?? 0;
    rows.push({
      cells: [
        c.number ?? "—",
        dash(c.budgetTitle),
        c.title,
        c.applicant || "—",
        dash(c.decisionRef),
        dash(c.instructionDate),
        dash(c.transferDate),
        eur(c.approvedAmount),
        eur(c.actualAmount),
      ],
    });
  }
  rows.push({
    cells: ["", "", "Summe", "", "", "", "", eur(totApproved), eur(totActual)],
    style: "total",
  });

  return {
    title: "Anträge nach Antragsnummer",
    columns: [
      { header: "Antragsnr.", width: 1.5 },
      HT,
      { header: "Titel", width: 3.2 },
      { header: "Antragsteller", width: 2.4 },
      { header: "Beschlussreferenz", width: 2.6 },
      { header: "Anweisung", width: 1.4 },
      { header: "Überweisung", width: 1.4 },
      { header: "Genehmigt (€)", width: 1.6, money: true },
      { header: "Getätigt (€)", width: 1.6, money: true },
    ],
    rows,
  };
}

/** Baut die Export-Tabelle für eine Finanz-View im offiziellen Layout. */
export function buildFinanceTable(view: string, data: FinanceData): Table {
  switch (view) {
    case "live":
      return expenseTable("Live-Ausgaben", data.live);
    case "actual":
      return expenseTable("Tatsächliche Ausgaben", data.actual);
    case "antraege":
      return antraegeTable(data);
    case "antraege_nr":
      return antraegeByNumberTable(data);
    default:
      return planTable(data);
  }
}
