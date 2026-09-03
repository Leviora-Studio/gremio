// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProtocolState } from "@/app/intern/protokolle/actions";
import { renderDecisionRef, renderSessionName, validateFilePattern } from "@/lib/protocol-markdown";

type Initial = {
  name: string;
  description: string | null;
  ncUrl: string;
  ncUsername: string;
  rootPath: string;
  folderPattern: string;
  filePattern: string;
  templateId: number;
  boardId: number | null;
  sourceStatusId: number | null;
  decisionRefPattern: string;
};

export function ProtocolAreaConfigForm({
  action,
  templates,
  boards,
  initial,
}: {
  action: (state: ProtocolState, formData: FormData) => Promise<ProtocolState>;
  templates: { id: number; name: string }[];
  boards: { id: number; name: string; statuses: { id: number; name: string }[] }[];
  initial?: Initial;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  const [name, setName] = useState(initial?.name ?? "");
  const [folderPattern, setFolderPattern] = useState(initial?.folderPattern ?? "{YYYY}-{MM}-{DD}");
  const [filePattern, setFilePattern] = useState(initial?.filePattern ?? "Protokoll.md");
  const [decisionPattern, setDecisionPattern] = useState(initial?.decisionRefPattern ?? "{session}-TOP-{top}");
  const [boardId, setBoardId] = useState(initial?.boardId ? String(initial.boardId) : "");
  const currentBoard = boards.find((board) => String(board.id) === boardId);
  const preview = useMemo(() => {
    try {
      const folder = renderSessionName(folderPattern, "2026-08-14", name || "Beispielgremium");
      const file = validateFilePattern(filePattern, "2026-08-14", name || "Beispielgremium", folder);
      const decision = renderDecisionRef(decisionPattern, folder, "2026-08-14", "5.1");
      return { folder, file, decision };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [decisionPattern, filePattern, folderPattern, name]);

  return (
    <form action={formAction} className="space-y-6">
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Beschreibung (optional)</label>
          <input name="description" className="input" defaultValue={initial?.description ?? ""} />
        </div>
        <div>
          <label className="label">Protokollvorlage</label>
          <select name="templateId" required className="input" defaultValue={initial?.templateId ?? ""}>
            <option value="">— Vorlage wählen —</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </div>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="font-semibold">Nextcloud / WebDAV</h2>
          <p className="text-xs text-slate-500">Bitte ein App-Passwort verwenden. Zugangsdaten werden verschlüsselt und nie an den Browser zurückgegeben.</p>
        </div>
        <div>
          <label className="label">WebDAV-URL</label>
          <input name="ncUrl" type="url" required className="input" placeholder="https://cloud.example/remote.php/dav/files/user" defaultValue={initial?.ncUrl} />
        </div>
        <div>
          <label className="label">Benutzername</label>
          <input name="ncUsername" required className="input" autoComplete="username" defaultValue={initial?.ncUsername} />
        </div>
        <div>
          <label className="label">{initial ? "App-Passwort (leer = unverändert)" : "App-Passwort"}</label>
          <input name="ncPassword" type="password" required={!initial} className="input" autoComplete="new-password" />
        </div>
        <div>
          <label className="label">WebDAV-Wurzelpfad</label>
          <input name="rootPath" required className="input" placeholder="/Protokolle" defaultValue={initial?.rootPath ?? "/Protokolle"} />
        </div>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="label">Schema für Sitzungsordner</label>
          <input name="folderPattern" className="input font-mono" value={folderPattern} onChange={(e) => setFolderPattern(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{`{YYYY} {MM} {DD} {date} {session} {area}`}</p>
        </div>
        <div>
          <label className="label">Schema für Protokolldatei</label>
          <input name="filePattern" className="input font-mono" value={filePattern} onChange={(e) => setFilePattern(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Muss auf .md enden; dieselben Platzhalter.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Schema für Beschlussreferenz</label>
          <input name="decisionRefPattern" className="input font-mono" value={decisionPattern} onChange={(e) => setDecisionPattern(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{`{session} {top} {YYYY} {MM} {DD}`}</p>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-sm sm:col-span-2">
          {"error" in preview ? <span className="text-red-600">{preview.error}</span> : (
            <span>Vorschau: <code>{preview.folder}/{preview.file}</code> · Beschlussreferenz <code>{preview.decision}</code></span>
          )}
        </div>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="label">Antrags-/Finanzboard (optional)</label>
          <select name="boardId" className="input" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">— Keine Verknüpfung —</option>
            {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Quellspalte</label>
          <select name="sourceStatusId" className="input" key={boardId} defaultValue={boardId === String(initial?.boardId ?? "") ? initial?.sourceStatusId ?? "" : ""} disabled={!currentBoard}>
            <option value="">— Spalte wählen —</option>
            {currentBoard?.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
          </select>
        </div>
      </section>

      {(state.error || state.success) && <p className={`text-sm ${state.error ? "text-red-600" : "text-green-700"}`}>{state.error ?? state.success}</p>}
      <button type="submit" disabled={pending || templates.length === 0} className="btn-primary">
        {pending ? "Prüfe Verbindung…" : initial ? "Einstellungen speichern" : "Protokollbereich anlegen"}
      </button>
    </form>
  );
}
