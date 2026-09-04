// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProtocolState } from "@/app/intern/protokolle/actions";
import { renderDecisionRef, renderSessionName, validateFilePattern } from "@/lib/protocol-markdown";
import { renderResultProtocolFilename } from "@/lib/result-protocol-filename";
import { orderedProtocolFinanceFields, type ProtocolFinanceField } from "@/lib/protocol-area-config";
import { MarkdownSettingsEditor } from "@/components/documents/MarkdownSettingsEditor";
import { ProtocolFinanceFields } from "./ProtocolFinanceFields";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { Select } from "@/components/Select";

type Initial = {
  name: string;
  description: string | null;
  ncUrl: string;
  ncUsername: string;
  rootPath: string;
  folderPattern: string;
  filePattern: string;
  resultFilePattern: string;
  templateId: number | null;
  customTemplateMarkdown: string;
  financeFields: ProtocolFinanceField[];
  decisionTemplateEnabled: boolean;
  decisionTemplateMarkdown: string;
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
  boards: { id: number; name: string; statuses: { id: number; name: string }[]; fields: string[] }[];
  initial?: Initial;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ProtocolState);
  const [name, setName] = useState(initial?.name ?? "");
  const [folderPattern, setFolderPattern] = useState(initial?.folderPattern ?? "{YYYY}-{MM}-{DD}");
  const [filePattern, setFilePattern] = useState(initial?.filePattern ?? "Protokoll.md");
  const [resultFilePattern, setResultFilePattern] = useState(initial?.resultFilePattern ?? "Ergebnisprotokoll.md");
  const [decisionPattern, setDecisionPattern] = useState(initial?.decisionRefPattern ?? "{session}-TOP-{top}");
  const [boardId, setBoardId] = useState(initial?.boardId ? String(initial.boardId) : "");
  const currentBoard = boards.find((board) => String(board.id) === boardId);
  const [templateId, setTemplateId] = useState(initial ? String(initial.templateId ?? "custom") : "");
  const [customTemplate, setCustomTemplate] = useState(initial?.customTemplateMarkdown ?? "# Sitzung {{session.date_de}}\n\n## Anwesenheit\n\n### Mitglieder\n\n### Gäste\n\n## Tagesordnung\n");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [decisionEnabled, setDecisionEnabled] = useState(initial?.decisionTemplateEnabled ?? false);
  const [decisionTemplate, setDecisionTemplate] = useState(initial?.decisionTemplateMarkdown ?? "");
  const [fieldsByBoard, setFieldsByBoard] = useState<Record<string, ProtocolFinanceField[]>>({ [String(initial?.boardId ?? "")]: initial?.financeFields ?? [] });
  const fields = orderedProtocolFinanceFields(fieldsByBoard[boardId] ?? [], currentBoard?.fields ?? []);
  const preview = useMemo(() => {
    try {
      const folder = renderSessionName(folderPattern, "2026-08-14", name || "Beispielgremium");
      const file = validateFilePattern(filePattern, "2026-08-14", name || "Beispielgremium", folder);
      const resultFile = renderResultProtocolFilename(resultFilePattern, name || "Beispielgremium", folder, "2026-08-14", file);
      const decision = renderDecisionRef(decisionPattern, folder, "2026-08-14", "5.1");
      return { folder, file, resultFile, decision };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [decisionPattern, filePattern, folderPattern, name, resultFilePattern]);

  return (
    <form action={formAction} className="space-y-8" onInvalidCapture={event => { let parent = (event.target as HTMLElement).parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } }}>
      <input type="hidden" name="customTemplateMarkdown" value={customTemplate} />
      <input type="hidden" name="decisionTemplateMarkdown" value={decisionTemplate} />
      <input type="hidden" name="financeFields" value={JSON.stringify(fields)} />
      <CollapsibleSection title="Allgemein" defaultOpen={!initial} contentClassName="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Beschreibung (optional)</label>
          <input name="description" className="input" defaultValue={initial?.description ?? ""} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Protokollvorlage" contentClassName="space-y-4 min-w-0">
        <div>
          <label className="label">Protokollvorlage</label>
          <Select portal name="templateId" ariaLabel="Protokollvorlage" value={templateId} onChange={value => { setTemplateId(value); if (value === "custom") setTemplateOpen(true); }} options={[{ value: "", label: "— Vorlage wählen —" }, ...templates.map(template => ({ value: String(template.id), label: template.name })), { value: "custom", label: "Eigene" }]} />
        </div>
        {templateId === "custom" && <CollapsibleSection title="Eigene Protokollvorlage bearbeiten" className="min-w-0" defaultOpen={templateOpen}>
          <p className="mb-3 text-xs text-slate-500">Gilt nur für neue Protokolle in diesem Bereich. Vorhandene Protokolle bleiben unverändert. Die Vorlage wird mit den Einstellungen gespeichert.</p>
          <MarkdownSettingsEditor label="Eigene Protokollvorlage" value={customTemplate} onChange={setCustomTemplate} disabled={pending} />
          <p className="mt-2 text-xs text-slate-500">Variablen: {"{{session.date}}, {{session.date_de}}, {{session.folder_name}}, {{protocol_area.name}}, {{created_at}}"}</p>
        </CollapsibleSection>}
      </CollapsibleSection>

      <CollapsibleSection title="Nextcloud / WebDAV" contentClassName="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-xs text-slate-500">Bitte ein App-Passwort verwenden. Zugangsdaten werden verschlüsselt und nie an den Browser zurückgegeben.</p>
        </div>
        <div>
          <label className="label">WebDAV-URL</label>
          <input name="ncUrl" type="url" required className="input" placeholder="https://cloud.example/remote.php/dav/files/user" defaultValue={initial?.ncUrl} />
        </div>
        <div>
          <label className="label">WebDAV-Wurzelpfad</label>
          <input name="rootPath" required className="input" placeholder="/Protokolle" defaultValue={initial?.rootPath ?? "/Protokolle"} />
        </div>
        <div>
          <label className="label">Benutzername</label>
          <input name="ncUsername" required className="input" autoComplete="username" defaultValue={initial?.ncUsername} />
        </div>
        <div>
          <label className="label">{initial ? "App-Passwort (leer = unverändert)" : "App-Passwort"}</label>
          <input name="ncPassword" type="password" required={!initial} className="input" autoComplete="new-password" />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Ordner, Dateinamen & Beschlussreferenz" contentClassName="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
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
        <div>
          <label className="label">Schema für Ergebnisprotokolldatei</label>
          <input name="resultFilePattern" className="input font-mono" value={resultFilePattern} onChange={(e) => setResultFilePattern(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Muss auf .md enden; dieselben Platzhalter.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Schema für Beschlussreferenz</label>
          <input name="decisionRefPattern" className="input font-mono" value={decisionPattern} onChange={(e) => setDecisionPattern(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{`{session} {top} {YYYY} {MM} {DD}`}</p>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-sm sm:col-span-2">
          {"error" in preview ? <span className="text-red-600">{preview.error}</span> : (
            <span>Vorschau: <code>{preview.folder}/{preview.file}</code> · Ergebnis <code>{preview.folder}/{preview.resultFile}</code> · Beschlussreferenz <code>{preview.decision}</code></span>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Finanzanträge" contentClassName="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Antrags-/Finanzboard (optional)</label>
          <Select portal name="boardId" ariaLabel="Antrags-/Finanzboard" value={boardId} onChange={setBoardId} options={[{ value: "", label: "— Keine Verknüpfung —" }, ...boards.map(board => ({ value: String(board.id), label: board.name }))]} />
        </div>
        <div>
          <label className="label">Quellspalte</label>
          <Select portal name="sourceStatusId" ariaLabel="Quellspalte" key={boardId} defaultValue={boardId === String(initial?.boardId ?? "") ? String(initial?.sourceStatusId ?? "") : ""} disabled={!currentBoard} options={[{ value: "", label: "— Spalte wählen —" }, ...(currentBoard?.statuses ?? []).map(status => ({ value: String(status.id), label: status.name }))]} />
        </div>
        {currentBoard && <div className="min-w-0 space-y-5 border-t border-slate-100 pt-4 sm:col-span-2">
          <div className="space-y-3">
            <h2 className="font-semibold">Kartenfelder im Protokoll</h2>
            <p className="text-xs text-slate-500">Sichtbare Board-Felder auswählen und am Griff in die gewünschte Reihenfolge ziehen. TOP-Überschrift und Antragslink bleiben immer erhalten. Bei Anhängen werden die Dateinamen übernommen.</p>
            <ProtocolFinanceFields fields={fields} disabled={pending} onChange={next => setFieldsByBoard(current => ({ ...current, [boardId]: next }))} />
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="decisionTemplateEnabled" checked={decisionEnabled} disabled={pending} onChange={event => setDecisionEnabled(event.target.checked)} />Beschlussvorlage</label>
            {decisionEnabled && <>
              <p className="text-xs text-slate-500">Wird beim Einplanen eines Finanzantrags unverändert unter die Angaben eingefügt. Ein leeres Feld fügt nichts hinzu.</p>
              <MarkdownSettingsEditor label="Beschlussvorlage" value={decisionTemplate} onChange={setDecisionTemplate} disabled={pending} />
            </>}
          </div>
        </div>}
      </CollapsibleSection>

      {(state.error || state.success) && <p className={`text-sm ${state.error ? "text-red-600" : "text-green-700"}`}>{state.error ?? state.success}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Prüfe Verbindung…" : initial ? "Einstellungen speichern" : "Protokollbereich anlegen"}
      </button>
    </form>
  );
}
