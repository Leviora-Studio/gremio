// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, boardStatuses, users } from "@/lib/db/schema";
import { requireBoardAccess } from "@/lib/authz";
import { getAssigneeIdsForCards } from "@/lib/assignees";
import { getPriorities } from "@/lib/priorities";
import { formatCents } from "@/lib/money";
import { todayInBerlin, berlinYearMonth } from "@/lib/dates";
import { priorityBadgeClass } from "@/lib/constants";

const MONTHS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

function Bar({
  label,
  count,
  max,
  badgeClass,
}: {
  label: React.ReactNode;
  count: number;
  max: number;
  badgeClass?: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0 truncate text-slate-600">{label}</div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
        <div
          className={`h-full rounded ${badgeClass ?? "bg-brand-500"}`}
          style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
        />
      </div>
      <div className="w-10 shrink-0 text-right tabular-nums">{count}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function BoardStatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const boardId = Number(id);
  const { board } = await requireBoardAccess(boardId);

  const rows = await db
    .select({
      id: cards.id,
      statusId: cards.statusId,
      priorityId: cards.priorityId,
      deadline: cards.deadline,
      createdAt: cards.createdAt,
      locationId: cards.locationId,
      approvedAmount: cards.approvedAmount,
      actualAmount: cards.actualAmount,
      archivedAt: cards.archivedAt,
      doneSince: cards.doneSince,
    })
    .from(cards)
    .where(eq(cards.boardId, boardId));

  const statuses = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position));

  const priorities = await getPriorities();

  // Zugewiesene je Karte (n:m) — eine Karte zählt bei JEDEM Zugewiesenen mit.
  const assigneeMap = await getAssigneeIdsForCards(rows.map((r) => r.id));
  const assigneeIds = [...new Set([...assigneeMap.values()].flat())];
  const assigneeRows = assigneeIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, assigneeIds))
    : [];
  const nameOf = new Map(assigneeRows.map((u) => [u.id, u.username]));

  const total = rows.length;
  const today = todayInBerlin();
  // „Aktiv" = NICHT archiviert UND NICHT in der Done-Spalte. Erledigte Karten
  // zählen bei „Überfällig" und „Zugewiesen" nicht mit (auch wenn ihre Deadline
  // längst vergangen ist).
  const isActive = (r: (typeof rows)[number]) =>
    r.archivedAt == null && r.statusId !== board.doneStatusId;
  const activeRows = rows.filter(isActive);
  const overdue = activeRows.filter((r) => r.deadline && r.deadline < today).length;
  const fromForm = rows.filter((r) => r.locationId != null).length;
  const manual = total - fromForm;
  const approvedSum = rows.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  const actualSum = rows.reduce((s, r) => s + (r.actualAmount ?? 0), 0);

  // Nach Spalte — die Done-Spalte ausblenden (dafür gibt es „Erledigt").
  const byStatus = statuses
    .filter((s) => s.id !== board.doneStatusId)
    .map((s) => ({
      name: s.name,
      count: rows.filter((r) => r.statusId === s.id).length,
    }));
  const maxStatus = Math.max(1, ...byStatus.map((x) => x.count));

  // Nach Priorität (+ ohne) — nur aktive Karten (nicht archiviert/Done).
  const byPriority = priorities.map((p) => ({
    label: p.label,
    color: p.color,
    count: activeRows.filter((r) => r.priorityId === p.id).length,
  }));
  const noPriority = activeRows.filter((r) => r.priorityId == null).length;
  const maxPriority = Math.max(1, ...byPriority.map((x) => x.count), noPriority);

  // Zugewiesen (Top 8 + ohne)
  const assigneeCounts = assigneeIds
    .map((aid) => ({
      label: nameOf.get(aid) ?? "?",
      count: activeRows.filter((r) => (assigneeMap.get(r.id) ?? []).includes(aid))
        .length,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const noAssignee = activeRows.filter(
    (r) => (assigneeMap.get(r.id) ?? []).length === 0,
  ).length;
  const maxAssignee = Math.max(1, ...assigneeCounts.map((x) => x.count), noAssignee);

  // Neue Karten je Monat (letzte 6 Monate). Monatsgrenzen in Europe/Berlin
  // (unabhängig von der Server-Zeitzone) über Jahr-Monat-Schlüssel "YYYY-MM".
  const [curYear, curMonth1] = berlinYearMonth().split("-").map(Number); // Monat 1–12
  const monthKeyAgo = (i: number): string => {
    const t = curYear * 12 + (curMonth1 - 1) - i; // ganzzahlige Monatsarithmetik
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };

  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const key = monthKeyAgo(i);
    buckets.push({
      key,
      label: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`,
      count: 0,
    });
  }
  for (const r of rows) {
    const b = buckets.find((x) => x.key === berlinYearMonth(r.createdAt));
    if (b) b.count++;
  }
  const maxMonth = Math.max(1, ...buckets.map((b) => b.count));

  // Erledigt: Karten mit gesetztem doneSince (= in Done-Spalte ODER archiviert).
  // doneSince ist der Zeitpunkt des Erledigens und überlebt das Archivieren.
  // Pro Zugewiesenem gezählt (Karte mit mehreren Zugewiesenen zählt bei jedem).
  // Monatszuordnung ebenfalls über den Berlin-Jahr-Monat.
  const thisMonthKey = monthKeyAgo(0);
  const lastMonthKey = monthKeyAgo(1);

  // Board-weit: wie viele KARTEN wurden erledigt (jede Karte einmal gezählt).
  const completedRows = rows.filter((r) => r.doneSince != null);
  const doneTotal = completedRows.length;
  const doneThisMonth = completedRows.filter(
    (r) => berlinYearMonth(r.doneSince!) === thisMonthKey,
  ).length;
  const doneLastMonth = completedRows.filter(
    (r) => berlinYearMonth(r.doneSince!) === lastMonthKey,
  ).length;

  type Done = { total: number; thisMonth: number; lastMonth: number };
  const newDone = (): Done => ({ total: 0, thisMonth: 0, lastMonth: 0 });
  const doneByUser = new Map<number, Done>();
  const doneNobody = newDone();
  for (const r of rows) {
    if (!r.doneSince) continue;
    const ym = berlinYearMonth(r.doneSince);
    const bump = (e: Done) => {
      e.total++;
      if (ym === thisMonthKey) e.thisMonth++;
      else if (ym === lastMonthKey) e.lastMonth++;
    };
    const ids = assigneeMap.get(r.id) ?? [];
    if (ids.length === 0) bump(doneNobody);
    else
      for (const uid of ids) {
        const e = doneByUser.get(uid) ?? newDone();
        bump(e);
        doneByUser.set(uid, e);
      }
  }
  const doneStats = [...doneByUser.entries()]
    .map(([uid, c]) => ({ uid, label: nameOf.get(uid) ?? "?", ...c }))
    .sort((a, b) => b.total - a.total || b.thisMonth - a.thisMonth);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <div>
        <Link href={`/intern/board/${boardId}`} className="text-sm text-brand-600">
          ← Zurück zum Board
        </Link>
        <h1 className="text-2xl font-bold">Statistik: {board.name}</h1>
      </div>

      {total === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          Noch keine Karten auf diesem Board.
        </div>
      ) : (
        <>
          <Section title="Überblick">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Karten gesamt", value: total },
                { label: "Überfällig", value: overdue },
                { label: "Über Formular", value: fromForm },
                { label: "Manuell angelegt", value: manual },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-md border border-slate-200 p-3">
                  <div className="text-2xl font-bold text-brand-700">
                    {kpi.value}
                  </div>
                  <div className="text-xs text-slate-500">{kpi.label}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Karten je Spalte">
            <div className="space-y-2">
              {byStatus.map((s) => (
                <Bar key={s.name} label={s.name} count={s.count} max={maxStatus} />
              ))}
            </div>
          </Section>

          <Section title="Nach Priorität">
            <div className="space-y-2">
              {byPriority.map((p) => (
                <Bar
                  key={p.label}
                  label={
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${priorityBadgeClass(
                        p.color,
                      )}`}
                    >
                      {p.label}
                    </span>
                  }
                  count={p.count}
                  max={maxPriority}
                />
              ))}
              <Bar label="ohne Priorität" count={noPriority} max={maxPriority} />
            </div>
          </Section>

          <Section title="Zugewiesen">
            <div className="space-y-2">
              {assigneeCounts.map((a) => (
                <Bar key={a.label} label={a.label} count={a.count} max={maxAssignee} />
              ))}
              <Bar label="ohne Zuweisung" count={noAssignee} max={maxAssignee} />
            </div>
          </Section>

          <Section title="Erledigt">
            <div className="mb-4 grid grid-cols-3 gap-4">
              {[
                { label: "Gesamt", value: doneTotal },
                { label: "Dieser Monat", value: doneThisMonth },
                { label: "Letzter Monat", value: doneLastMonth },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-md border border-slate-200 p-3"
                >
                  <div className="text-2xl font-bold text-brand-700">
                    {kpi.value}
                  </div>
                  <div className="text-xs text-slate-500">{kpi.label}</div>
                </div>
              ))}
            </div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Je Nutzer</h3>
            {doneStats.length === 0 && doneNobody.total === 0 ? (
              <p className="text-sm text-slate-500">
                Noch keine erledigten Karten.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-2 font-medium">Nutzer</th>
                    <th className="px-2 py-1.5 text-right font-medium">Gesamt</th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      Dieser Monat
                    </th>
                    <th className="py-1.5 pl-2 text-right font-medium">
                      Letzter Monat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {doneStats.map((c) => (
                    <tr key={c.uid} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2">{c.label}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {c.total}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {c.thisMonth}
                      </td>
                      <td className="py-1.5 pl-2 text-right tabular-nums">
                        {c.lastMonth}
                      </td>
                    </tr>
                  ))}
                  {doneNobody.total > 0 && (
                    <tr className="text-slate-500">
                      <td className="py-1.5 pr-2">ohne Zuweisung</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {doneNobody.total}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {doneNobody.thisMonth}
                      </td>
                      <td className="py-1.5 pl-2 text-right tabular-nums">
                        {doneNobody.lastMonth}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Neue Karten je Monat (letzte 6)">
            <div className="space-y-2">
              {buckets.map((b) => (
                <Bar key={b.key} label={b.label} count={b.count} max={maxMonth} />
              ))}
            </div>
          </Section>

          {(approvedSum > 0 || actualSum > 0) && (
            <Section title="Beträge">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xl font-bold text-brand-700">
                    {formatCents(approvedSum)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Summe genehmigter Beträge
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xl font-bold text-brand-700">
                    {formatCents(actualSum)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Summe tatsächlicher Ausgaben
                  </div>
                </div>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
