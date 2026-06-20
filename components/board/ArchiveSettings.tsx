// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  setArchiveConfigAction,
  testArchiveAction,
  type State,
} from "@/app/intern/board/[id]/einstellungen/actions";
import { ARCHIVE_FOLDER_FIELDS } from "@/lib/constants";

const FIELD_LABEL = new Map<string, string>(
  ARCHIVE_FOLDER_FIELDS.map((f) => [f.key, f.label]),
);
const FIELD_EXAMPLE = new Map<string, string>(
  ARCHIVE_FOLDER_FIELDS.map((f) => [f.key, f.example]),
);
const ALL_KEYS = ARCHIVE_FOLDER_FIELDS.map((f) => f.key as string);

export function ArchiveSettings({
  boardId,
  config,
}: {
  boardId: number;
  config: {
    enabled: boolean;
    ncUrl: string | null;
    ncUsername: string | null;
    targetFolder: string | null;
    hasPassword: boolean;
    folderFields: string[];
    folderSeparator: string;
  };
}) {
  // Imperativer Action-Aufruf (kein <form action>), damit React 19 das Formular
  // nach dem Speichern nicht zurücksetzt — sonst entkoppeln sich die
  // kontrollierten Ordnernamen-Haken kurz (Flackern). Muster wie BoardNumberingForm.
  const [archiveEnabled, setArchiveEnabled] = useState(config.enabled);
  const [ncUrl, setNcUrl] = useState(config.ncUrl ?? "");
  const [ncUsername, setNcUsername] = useState(config.ncUsername ?? "");
  const [ncPassword, setNcPassword] = useState("");
  const [targetFolder, setTargetFolder] = useState(config.targetFolder ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<State>({});

  // „Verbindung testen" hat keine Eingaben → harmlos als eigenes Action-Formular.
  const [testState, testAction, testing] = useActionState(
    testArchiveAction.bind(null, boardId),
    {} as State,
  );

  // Reihenfolge ALLER Felder: gewählte (in gespeicherter Reihenfolge) zuerst,
  // danach die übrigen. Auswahl separat als Set.
  const initialEnabled = config.folderFields.filter((k) => ALL_KEYS.includes(k));
  const [order, setOrder] = useState<string[]>([
    ...initialEnabled,
    ...ALL_KEYS.filter((k) => !initialEnabled.includes(k)),
  ]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initialEnabled));
  // Leeres Feld = Leerzeichen → gespeichertes " " als leeres Feld anzeigen.
  const [sep, setSep] = useState(
    config.folderSeparator === " " ? "" : config.folderSeparator,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oi = prev.indexOf(String(active.id));
      const ni = prev.indexOf(String(over.id));
      return oi < 0 || ni < 0 ? prev : arrayMove(prev, oi, ni);
    });
  };

  const enabledOrdered = order.filter((k) => enabled.has(k));
  const folderFieldsValue = enabledOrdered.join(",");
  const effSep = sep === "" ? " " : sep;
  const preview =
    enabledOrdered.map((k) => FIELD_EXAMPLE.get(k)).join(effSep) ||
    "(leer → Titel)";

  function save() {
    const fd = new FormData();
    if (archiveEnabled) fd.set("enabled", "on");
    fd.set("ncUrl", ncUrl);
    fd.set("ncUsername", ncUsername);
    fd.set("ncPassword", ncPassword);
    fd.set("targetFolder", targetFolder);
    fd.set("folderFields", folderFieldsValue);
    fd.set("folderSeparator", sep);
    startTransition(async () => {
      setMsg(await setArchiveConfigAction(boardId, {} as State, fd));
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Erreicht ein Antrag die oben gewählte Trigger-Spalte und ist die
        Archivierung aktiv, werden alle Anhänge automatisch in einen Unterordner
        des Zielordners hochgeladen. Zugangsdaten werden verschlüsselt
        gespeichert (Empfehlung: Nextcloud-App-Passwort).
      </p>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={archiveEnabled}
            onChange={(e) => setArchiveEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Archivierung für dieses Board aktiv
        </label>
        <div>
          <label className="label">WebDAV-URL</label>
          <input
            value={ncUrl}
            onChange={(e) => setNcUrl(e.target.value)}
            className="input"
            placeholder="https://cloud.example.org/remote.php/dav/files/USER/"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Benutzername</label>
            <input
              value={ncUsername}
              onChange={(e) => setNcUsername(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">
              Passwort {config.hasPassword && "(gesetzt — leer lassen zum Behalten)"}
            </label>
            <input
              type="password"
              value={ncPassword}
              onChange={(e) => setNcPassword(e.target.value)}
              className="input"
              placeholder={config.hasPassword ? "••••••••" : ""}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div>
          <label className="label">Zielordner</label>
          <input
            value={targetFolder}
            onChange={(e) => setTargetFolder(e.target.value)}
            className="input"
            placeholder="/Archiv"
          />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <label className="label">Ordnername je Antrag</label>
          <p className="text-xs text-slate-500">
            Hake die Felder an, aus denen der Unterordner-Name gebaut wird, und
            ziehe sie am <span className="font-mono">⠿</span> in die gewünschte
            Reihenfolge. Leere Felder werden übersprungen.
          </p>

          <DndContext
            id="dnd-archive-folder"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="max-w-sm space-y-1">
                {order.map((k) => (
                  <SortableField
                    key={k}
                    id={k}
                    label={FIELD_LABEL.get(k) ?? k}
                    checked={enabled.has(k)}
                    onToggle={(on) =>
                      setEnabled((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(k);
                        else next.delete(k);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="flex items-center gap-2 pt-1">
            <label className="text-sm text-slate-600" htmlFor="folderSeparator">
              Trennzeichen
            </label>
            <input
              id="folderSeparator"
              value={sep}
              onChange={(e) => setSep(e.target.value)}
              maxLength={5}
              placeholder="Leerzeichen"
              className="input w-28"
            />
            <span className="text-xs text-slate-400">leer = Leerzeichen</span>
          </div>
          <p className="text-xs text-slate-500">
            Beispiel-Ordner:{" "}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
              {preview}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="btn-primary"
          >
            {"Speichern"}
          </button>
          {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
          {msg.success && (
            <span className="text-sm text-green-600">{msg.success}</span>
          )}
        </div>
      </div>

      <form action={testAction} className="flex items-center gap-3 border-t border-slate-100 pt-3">
        <button type="submit" disabled={testing} className="btn-secondary">
          {testing ? "Teste…" : "Verbindung testen"}
        </button>
        {testState.error && (
          <span className="text-sm text-red-600">{testState.error}</span>
        )}
        {testState.success && (
          <span className="text-sm text-green-600">{testState.success}</span>
        )}
      </form>
    </div>
  );
}

function SortableField({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm ${
        isDragging ? "opacity-60 shadow" : ""
      }`}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab select-none text-slate-400 active:cursor-grabbing"
        title="Ziehen zum Sortieren"
        aria-label="Sortieren"
      >
        ⠿
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4"
      />
      <span className={checked ? "" : "text-slate-400"}>{label}</span>
    </div>
  );
}
