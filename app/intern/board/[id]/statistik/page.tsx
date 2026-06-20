// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, boardStatuses, users } from "@/lib/db/schema";
import { requireBoardManage } from "@/lib/authz";
import { getAssigneeIdsForCards } from "@/lib/assignees";
import { getPriorities } from "@/lib/priorities";
import { formatCents } from "@/lib/money";
import { todayInBerlin } from "@/lib/dates";
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
  const { board } = await requireBoardManage(boardId);

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
  const overdue = rows.filter((r) => r.deadline && r.deadline < today).length;
  const fromForm = rows.filter((r) => r.locationId != null).length;
  const manual = total - fromForm;
  const approvedSum = rows.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  const actualSum = rows.reduce((s, r) => s + (r.actualAmount ?? 0), 0);

  // Nach Spalte
  const byStatus = statuses.map((s) => ({
    name: s.name,
    count: rows.filter((r) => r.statusId === s.id).length,
  }));
  const maxStatus = Math.max(1, ...byStatus.map((x) => x.count));

  // Nach Priorität (+ ohne)
  const byPriority = priorities.map((p) => ({
    label: p.label,
    color: p.color,
    count: rows.filter((r) => r.priorityId === p.id).length,
  }));
  const noPriority = rows.filter((r) => r.priorityId == null).length;
  const maxPriority = Math.max(1, ...byPriority.map((x) => x.count), noPriority);

  // Zugewiesen (Top 8 + ohne)
  const assigneeCounts = assigneeIds
    .map((aid) => ({
      label: nameOf.get(aid) ?? "?",
      count: rows.filter((r) => (assigneeMap.get(r.id) ?? []).includes(aid)).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const noAssignee = rows.filter(
    (r) => (assigneeMap.get(r.id) ?? []).length === 0,
  ).length;
  const maxAssignee = Math.max(1, ...assigneeCounts.map((x) => x.count), noAssignee);

  // Neue Karten je Monat (letzte 6 Monate)
  const now = new Date();
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({
      key,
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      count: 0,
    });
  }
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.find((x) => x.key === key);
    if (b) b.count++;
  }
  const maxMonth = Math.max(1, ...buckets.map((b) => b.count));

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
