// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Select } from "@/components/Select";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/app/intern/konto/actions";

export type TokenRow = {
  id: number;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string; // ISO
  lastUsedAt: string | null; // ISO
  boards: string[]; // eingeschränkte Board-Namen; leer = alle
};

export type BoardOption = { id: number; name: string };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const scopeBadge = (s: "read" | "write") =>
  s === "write"
    ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";

export function ApiTokens({
  tokens,
  boards,
  baseUrl,
}: {
  tokens: TokenRow[];
  boards: BoardOption[];
  baseUrl: string;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState<{ token: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggleBoard = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const create = () => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const r = await createApiTokenAction({
        name,
        scope,
        boardIds: [...selected],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreated({ token: r.token, name: r.name });
      setName("");
      setScope("read");
      setSelected(new Set());
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-semibold">API-Tokens</h2>
      <p className="mb-4 text-sm text-slate-500">
        Persönliche Zugriffstokens für die REST-API (<code>{baseUrl}/api/v1</code>
        ). Ein Token erbt deine Board-Zugriffe und lässt sich auf{" "}
        <strong>nur lesen</strong> sowie auf <strong>bestimmte Boards</strong>{" "}
        einschränken. Übergib ihn als Header{" "}
        <code>Authorization: Bearer …</code>.
      </p>

      {created ? (
        <div className="mb-5 rounded-md border border-green-300 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            Token „{created.name}" erstellt — wird{" "}
            <strong>nur jetzt einmal</strong> angezeigt. Kopiere ihn an einen
            sicheren Ort.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-green-300 bg-white px-3 py-2 text-xs">
              {created.token}
            </code>
            <button
              type="button"
              onClick={() => copy(created.token)}
              className="btn-secondary btn-sm shrink-0"
            >
              {copied ? "Kopiert ✓" : "Kopieren"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="btn-secondary btn-sm mt-3"
          >
            Fertig
          </button>
        </div>
      ) : (
        <div className="mb-5 space-y-3 rounded-md border border-slate-200 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow">
              <label className="label" htmlFor="token-name">
                Bezeichnung
              </label>
              <input
                id="token-name"
                className="input"
                placeholder="z.B. Sync-Skript Laptop"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="token-scope">
                Rechte
              </label>
              <Select
                id="token-scope"
                className="w-48"
                value={scope}
                onChange={(v) => setScope(v as "read" | "write")}
                options={[
                  { value: "read", label: "Nur Lesen" },
                  { value: "write", label: "Lesen + Schreiben" },
                ]}
              />
            </div>
          </div>

          <div>
            <span className="label mb-1">Boards</span>
            <p className="mb-2 text-xs text-slate-500">
              Nichts auswählen = alle deine Boards (auch künftige). Auswahl =
              nur diese Boards.
            </p>
            {boards.length === 0 ? (
              <p className="text-xs text-slate-400">Keine Boards verfügbar.</p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
                {boards.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleBoard(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {selected.size === 0
                ? "→ Alle Boards"
                : `→ ${selected.size} Board(s) ausgewählt`}
            </p>
          </div>

          <button
            type="button"
            onClick={create}
            disabled={pending || !name.trim()}
            className="btn-primary"
          >
            Token erstellen
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {tokens.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Tokens.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Rechte</th>
                <th className="py-2 pr-3">Boards</th>
                <th className="py-2 pr-3">Präfix</th>
                <th className="py-2 pr-3">Erstellt</th>
                <th className="py-2 pr-3">Zuletzt</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium">{t.name}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${scopeBadge(
                        t.scope,
                      )}`}
                    >
                      {t.scope === "write" ? "Schreiben" : "Lesen"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-600">
                    {t.boards.length === 0 ? (
                      <span className="text-slate-400">Alle</span>
                    ) : (
                      t.boards.join(", ")
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <code className="text-xs text-slate-500">{t.prefix}…</code>
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{fmt(t.createdAt)}</td>
                  <td className="py-2 pr-3 text-slate-500">
                    {fmt(t.lastUsedAt)}
                  </td>
                  <td className="py-2 text-right">
                    <ConfirmButton
                      action={() => revokeApiTokenAction(t.id)}
                      label="Widerrufen"
                      className="btn-danger btn-sm"
                      title="Token widerrufen?"
                      message={`Der Token „${t.name}" wird sofort ungültig. Skripte, die ihn nutzen, verlieren den Zugriff.`}
                      confirmLabel="Widerrufen"
                      confirmClassName="btn-danger"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="collapsible mt-5 text-sm">
        <summary className="cursor-pointer text-brand-600">
          Verwendung &amp; Endpunkte
        </summary>
        <div className="mt-3 space-y-2 text-slate-600">
          <p>Beispiel (Boards auflisten):</p>
          <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
            {`curl -H "Authorization: Bearer grm_…" \\\n  ${baseUrl}/api/v1/boards`}
          </pre>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            <li>
              <code>GET /api/v1/boards</code> — zugängliche Boards
            </li>
            <li>
              <code>GET /api/v1/boards/&#123;id&#125;</code> — Board + Spalten
            </li>
            <li>
              <code>GET /api/v1/boards/&#123;id&#125;/cards</code> — Karten
            </li>
            <li>
              <code>POST /api/v1/boards/&#123;id&#125;/cards</code> — Karte
              anlegen (nur Schreiben-Token)
            </li>
            <li>
              <code>PATCH /api/v1/cards/&#123;id&#125;</code> — ändern /
              verschieben (nur Schreiben-Token)
            </li>
            <li>
              <code>DELETE /api/v1/cards/&#123;id&#125;</code> — löschen (nur
              Schreiben-Token)
            </li>
          </ul>
        </div>
      </details>
    </section>
  );
}
