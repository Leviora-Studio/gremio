// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Document, Page, pdfjs } from "react-pdf";
import {
  savePdfEditsAction,
  type SavePdfInput,
  type SavePdfResult,
} from "@/app/intern/card/[id]/pdf-actions";

// pdf.js-Worker lokal (kein CDN — CSP-/Offline-tauglich).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Tool = "none" | "text" | "sign";

type TextItem = {
  id: number;
  fieldName?: string; // gesetzt = bestehendes Feld (Update), sonst neu
  page: number;
  xRatio: number;
  yRatio: number;
  text: string;
  sizeRatio: number;
};

type SignItem = {
  page: number;
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
};

type FieldMeta = {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "optionlist" | "radio" | "other";
  value: string | boolean | null;
  options?: string[];
  readOnly: boolean;
  page?: number;
  rect?: { xRatio: number; yRatio: number; wRatio: number; hRatio: number };
  sizeRatio?: number;
  gremioText?: boolean;
  multiline?: boolean;
  maxLength?: number;
  optionWidgets?: {
    value: string;
    page: number;
    rect: { xRatio: number; yRatio: number; wRatio: number; hRatio: number };
  }[];
  widgets?: {
    page: number;
    rect: { xRatio: number; yRatio: number; wRatio: number; hRatio: number };
  }[];
};

type Rect = { xRatio: number; yRatio: number; wRatio: number; hRatio: number };
type TextWidget = {
  name: string;
  page: number;
  rect: Rect;
  sizeRatio: number;
  multiline?: boolean;
  maxLength?: number;
};
type Control =
  | { kind: "checkbox"; name: string; page: number; rect: Rect }
  | { kind: "select"; name: string; page: number; rect: Rect; options: string[] }
  | { kind: "radio"; name: string; page: number; rect: Rect; optionValue: string };

export type PdfEditorProps = {
  src: string;
  filename: string;
  attachmentId: number;
  editable: boolean;
  hasCert: boolean;
  onClose: () => void;
  // Optional: abweichende Endpunkte (z. B. Inventar statt Karten-Anhang).
  fieldsUrl?: string;
  saveAction?: (input: SavePdfInput) => Promise<SavePdfResult>;
  sourceVersion?: string;
  saveButtonLabel?: string;
  saveButtonTitle?: string;
  /** Meldet ungespeicherte Änderungen (für die Rückfrage beim Schließen). */
  onDirtyChange?: (dirty: boolean) => void;
};

// Obergrenzen wie serverseitig (pdf-actions/pdf-apply), damit nichts still
// abgeschnitten wird.
const MAX_FREE_TEXT = 2000;
const MAX_FIELD_TEXT = 5000;
// Freitext-Schriftgröße in pt: Standard und Grenzen wie serverseitig (pdf-edit).
const DEFAULT_TEXT_PT = 12;
const MIN_TEXT_PT = 6;
const MAX_TEXT_PT = 64;
// pdf-lib-Layout (Helvetica): Zeilenabstand 1.2 × Schrifthöhe (0.925 em),
// Versalhöhe 0.718 em; die CSS-Grundlinie von Arial liegt bei ~0.9 em.
const PDF_LINE = 1.11;
const PDF_CAP = 0.718;
const CSS_BASELINE = 0.9;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
let nextId = 1;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Breite einer Textzeile in px (Arial/Helvetica, wie im PDF); Schätzung als Fallback. */
function textWidthPx(line: string, fontPx: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!measureCtx) return line.length * fontPx * 0.55;
  measureCtx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(line).width;
}

/** Einzeilige Felder können keinen Zeilenumbruch speichern → Leerzeichen. */
function fieldText(value: string, field: { multiline?: boolean; maxLength?: number }): string {
  const v = field.multiline ? value : value.replace(/\r\n?|\n/g, " ");
  return v.slice(0, Math.min(field.maxLength ?? MAX_FIELD_TEXT, MAX_FIELD_TEXT));
}

// Normalisierte Form eines Textes für den „dirty"-Vergleich (gerundet, ohne id).
function normText(t: TextItem) {
  return {
    f: t.fieldName ?? "",
    p: t.page,
    x: +t.xRatio.toFixed(3),
    y: +t.yRatio.toFixed(3),
    s: +t.sizeRatio.toFixed(4),
    t: t.text,
  };
}

export default function PdfEditor({
  src,
  filename,
  attachmentId,
  editable,
  hasCert,
  onClose,
  fieldsUrl,
  saveAction,
  sourceVersion,
  saveButtonLabel = "Speichern",
  saveButtonTitle = "Speichert die Änderungen ins Original",
  onDirtyChange,
}: PdfEditorProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialTextsRef = useRef<string>("[]");
  // Gespeicherte Freitexte beim Laden (für „nur Geänderte senden" und Löschen).
  const initialTextItemsRef = useRef<TextItem[]>([]);
  // Erhöht sich nach einem Teil-Erfolg: PDF + Felder neu vom Server laden.
  const [reloadKey, setReloadKey] = useState(0);
  const [fieldsError, setFieldsError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [baseWidth, setBaseWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("none");

  const [texts, setTexts] = useState<TextItem[]>([]);
  const [sign, setSign] = useState<SignItem | null>(null);
  const [sigReason, setSigReason] = useState("");

  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [fieldValues, setFieldValues] = useState<
    Record<string, string | boolean>
  >({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const width = Math.round(baseWidth * zoom);

  useLayoutEffect(() => {
    const measure = () => {
      const w = containerRef.current?.clientWidth;
      if (w) setBaseWidth(Math.max(320, Math.min(1100, w - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Formularfelder laden (nur im Editier-Modus).
  useEffect(() => {
    if (!editable) return;
    let active = true;
    fetch(fieldsUrl ?? `/api/attachment/${attachmentId}/fields`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { fields?: FieldMeta[] }) => {
        if (!active) return;
        setFieldsError(false);
        const fs = d.fields ?? [];
        setFields(fs);
        // Unsere Freitextfelder als verschieb-/skalierbare Texte übernehmen.
        const seeded: TextItem[] = fs
          .filter(
            (f) =>
              f.type === "text" &&
              f.gremioText &&
              f.rect &&
              f.page != null &&
              !f.readOnly,
          )
          .map((f) => ({
            id: nextId++,
            fieldName: f.name,
            page: f.page!,
            xRatio: f.rect!.xRatio,
            yRatio: f.rect!.yRatio,
            text: typeof f.value === "string" ? f.value : "",
            sizeRatio: f.sizeRatio ?? 0.02,
          }));
        setTexts(seeded);
        initialTextItemsRef.current = seeded;
        initialTextsRef.current = JSON.stringify(seeded.map(normText));
        // Restliche Felder fürs Panel / feste Overlays.
        const init: Record<string, string | boolean> = {};
        for (const f of fs) {
          if (f.gremioText) continue;
          if (f.type === "checkbox") init[f.name] = Boolean(f.value);
          else init[f.name] = typeof f.value === "string" ? f.value : "";
        }
        setFieldValues(init);
      })
      .catch(() => {
        // Nicht still schlucken: sonst wirkt das PDF einfach „ohne Felder".
        if (active) setFieldsError(true);
      });
    return () => {
      active = false;
    };
  }, [attachmentId, editable, fieldsUrl, reloadKey]);

  // Neuer Text startet leer und fokussiert (kein Platzhalter, der erst
  // markiert und gelöscht werden muss); bleibt er leer, verschwindet er wieder.
  const [focusTextId, setFocusTextId] = useState<number | null>(null);
  const addText = useCallback(
    (page: number, xRatio: number, yRatio: number, sizeRatio: number) => {
      const id = nextId++;
      setTexts((prev) => [...prev, { id, page, xRatio, yRatio, text: "", sizeRatio }]);
      setFocusTextId(id);
      setTool("none");
    },
    [],
  );

  const resizeText = useCallback((id: number, sizeRatio: number) => {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, sizeRatio } : t)));
  }, []);

  const moveText = useCallback((id: number, xRatio: number, yRatio: number) => {
    setTexts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, xRatio, yRatio } : t)),
    );
  }, []);

  const drawSign = useCallback((s: SignItem) => {
    setSign(s);
    setTool("none");
  }, []);

  function changedFields() {
    const out: { name: string; value: string | boolean }[] = [];
    for (const f of fields) {
      // Freitextfelder laufen über `texts`, nicht über das Panel.
      if (f.gremioText || f.readOnly) continue;
      const v = fieldValues[f.name];
      const orig = f.type === "checkbox" ? Boolean(f.value) : (f.value ?? "");
      if (v !== orig) out.push({ name: f.name, value: v });
    }
    return out;
  }

  // Nur neue, geänderte und entfernte Freitexte senden — unveränderte würden
  // sonst bei jedem Speichern (auch beim reinen Signieren) neu geschrieben.
  function changedTexts() {
    const initial = new Map(
      initialTextItemsRef.current.map((t) => [t.fieldName, JSON.stringify(normText(t))]),
    );
    const keep = new Set(texts.map((t) => t.fieldName).filter(Boolean));
    const changed = texts.filter(
      (t) => !t.fieldName || initial.get(t.fieldName) !== JSON.stringify(normText(t)),
    );
    // Entfernte gespeicherte Freitexte: leerer Text = Feld löschen.
    const removed = initialTextItemsRef.current
      .filter((t) => !keep.has(t.fieldName))
      .map((t) => ({ ...t, text: "" }));
    return [...changed, ...removed];
  }

  // Ein frisch gesetzter, noch leerer Text ist (noch) keine Änderung.
  const textsJson = JSON.stringify(
    texts.filter((t) => t.fieldName || t.text.trim()).map(normText),
  );
  const dirty =
    textsJson !== initialTextsRef.current ||
    !!sign ||
    changedFields().length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function handleSave() {
    setError(null);
    if (!dirty) {
      setError("Keine Änderungen zum Speichern.");
      return;
    }
    const fieldEdits = changedFields();
    if (sign && !hasCert) {
      setError(
        "Kein Signatur-Zertifikat hinterlegt — bitte zuerst in den Konto-Einstellungen hinzufügen.",
      );
      return;
    }
    const payload: SavePdfInput = {
      attachmentId,
      mode: "replace", // immer das Original überschreiben
      sourceVersion,
      edits: {
        texts: changedTexts().map((t) => ({
          name: t.fieldName,
          page: t.page,
          xRatio: t.xRatio,
          yRatio: t.yRatio,
          text: t.text,
          sizeRatio: t.sizeRatio,
        })),
        fields: fieldEdits,
      },
      signature: sign
        ? { placement: sign, reason: sigReason.trim() || undefined }
        : undefined,
    };
    setSaving(true);
    try {
      const res = await (saveAction ?? savePdfEditsAction)(payload);
      if (res.ok) {
        if (res.warning) {
          // Teil-Erfolg: gespeichert, aber einzelne Felder gingen nicht — anzeigen
          // und Modal offen lassen, damit der Nutzer es bemerkt. Den Editor auf
          // den gespeicherten Stand bringen, sonst legte ein erneutes Speichern
          // die neuen Freitexte doppelt an.
          setError(res.warning);
          setSign(null);
          setSigReason("");
          setReloadKey((k) => k + 1);
          router.refresh();
        } else {
          onDirtyChange?.(false);
          router.refresh();
          onClose();
        }
      } else {
        setError(res.error);
      }
    } catch {
      setError("Speichern fehlgeschlagen (Netzwerk?).");
    } finally {
      setSaving(false);
    }
  }

  // Echte (nicht von uns angelegte) Formularfelder direkt im PDF editieren:
  // Textfelder an fester Position, Haken/Auswahl/Radio als Steuerelemente.
  // Unsere Freitexte laufen über `texts`. Felder ohne Position → Panel (Fallback).
  // Pro Feld können MEHRERE Widgets existieren (z. B. zwei synchrone
  // „Antragsnummer"-Felder) → je Widget ein Steuerelement, alle an denselben
  // Wert gebunden.
  const widgetsOf = (f: FieldMeta) =>
    f.widgets?.length
      ? f.widgets
      : f.rect && f.page != null
        ? [{ page: f.page, rect: f.rect }]
        : [];

  const textWidgets: TextWidget[] = [];
  const controls: Control[] = [];
  if (editable) {
    for (const f of fields) {
      if (f.readOnly || f.gremioText) continue;
      if (f.type === "text") {
        for (const w of widgetsOf(f)) {
          textWidgets.push({
            name: f.name,
            page: w.page,
            rect: w.rect,
            sizeRatio: f.sizeRatio ?? 0.02,
            multiline: f.multiline,
            maxLength: f.maxLength,
          });
        }
      } else if (f.type === "checkbox") {
        for (const w of widgetsOf(f)) {
          controls.push({ kind: "checkbox", name: f.name, page: w.page, rect: w.rect });
        }
      } else if (f.type === "dropdown" || f.type === "optionlist") {
        for (const w of widgetsOf(f)) {
          controls.push({
            kind: "select",
            name: f.name,
            page: w.page,
            rect: w.rect,
            options: f.options ?? [],
          });
        }
      } else if (f.type === "radio" && f.optionWidgets?.length) {
        for (const ow of f.optionWidgets) {
          controls.push({
            kind: "radio",
            name: f.name,
            page: ow.page,
            rect: ow.rect,
            optionValue: ow.value,
          });
        }
      }
    }
  }

  const placedNames = new Set<string>([
    ...textWidgets.map((t) => t.name),
    ...controls.map((c) => c.name),
  ]);
  const panelFields = fields.filter(
    (f) => !f.gremioText && !placedNames.has(f.name),
  );

  const onChangeField = (name: string, value: string | boolean) =>
    setFieldValues((prev) => ({ ...prev, [name]: value }));

  return (
    <div data-live-refresh-managed data-live-refresh-dirty={dirty} data-live-refresh-block={dirty||saving} className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="grid grid-cols-3 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:flex sm:flex-wrap">
        {/* Dateiname nur auf Desktop — auf Mobil ist der Platz für die
            Bedienelemente reserviert (welche Datei ist aus dem Kontext klar). */}
        <span
          className="mr-1 hidden max-w-[16rem] truncate font-medium sm:block"
          title={filename}
        >
          {filename}
        </span>
        {/* Zoom bleibt als Einheit zusammen (bricht nicht zwischen − % + um). */}
        <div className="flex items-center justify-between gap-1 sm:justify-start">
          <button
            type="button"
            className="btn-secondary btn-sm px-2 sm:px-3"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums sm:w-11">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm px-2 sm:px-3"
            onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
          >
            +
          </button>
        </div>

        {editable && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-slate-300 sm:block" />
            <button
              type="button"
              className={`${tool === "text" ? "btn-primary" : "btn-secondary"} btn-sm`}
              onClick={() => setTool((t) => (t === "text" ? "none" : "text"))}
            >
              ✎ Text
            </button>
            <button
              type="button"
              className={`${tool === "sign" ? "btn-primary" : "btn-secondary"} btn-sm`}
              onClick={() => setTool((t) => (t === "sign" ? "none" : "sign"))}
              title={
                hasCert
                  ? "Bereich für die Signatur aufziehen"
                  : "Kein Zertifikat hinterlegt (Konto-Einstellungen)"
              }
            >
              ✒ Signieren
            </button>
            {tool !== "none" && (
              <span className="hidden text-xs text-brand-700 sm:inline">
                {tool === "text"
                  ? "Auf die Seite klicken, um Text zu setzen (danach verschiebbar)"
                  : "Auf der Seite einen Bereich aufziehen"}
              </span>
            )}
          </>
        )}

        {/* Auf Mobil lösen sich diese drei per display:contents in das 3-Spalten-
            Grid auf (gleich große Zellen wie Zoom/Text/Signieren). Ab sm: wieder
            als rechtsbündige Gruppe. */}
        <div className="contents sm:ml-auto sm:flex sm:items-center sm:gap-2">
          <a
            href={src}
            download={filename}
            className="btn-secondary btn-sm"
            title="PDF herunterladen"
          >
            ⤓ Herunterladen
          </a>
          {editable && (
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={saving || !dirty}
              onClick={handleSave}
              title={saveButtonTitle}
            >
              {saving ? "Speichert…" : saveButtonLabel}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={onClose}
          >
            Schließen
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">
          {error}
        </div>
      )}
      {editable && fieldsError && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
          Die Formularfelder dieses PDFs konnten nicht gelesen werden. Freitext und
          Signatur sind weiterhin möglich.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Seiten */}
        <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
          {loadError ? (
            <p className="p-6 text-sm text-slate-600">
              PDF konnte nicht geladen werden.{" "}
              <a href={src} target="_blank" rel="noopener" className="text-brand-600 underline">
                In neuem Tab öffnen
              </a>
            </p>
          ) : (
            <Document
              // Nach einem Teil-Erfolg die gespeicherte Fassung neu laden.
              key={reloadKey}
              file={reloadKey ? `${src}${src.includes("?") ? "&" : "?"}v=${reloadKey}` : src}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              onLoadError={() => setLoadError(true)}
              loading={<p className="p-6 text-sm text-slate-500">PDF wird geladen…</p>}
              error={<p className="p-6 text-sm text-red-600">Fehler beim Laden.</p>}
            >
              {Array.from({ length: numPages }, (_, i) => (
                <PageLayer
                  key={i}
                  pageIndex={i}
                  width={width}
                  tool={tool}
                  texts={texts.filter((t) => t.page === i)}
                  textWidgets={textWidgets.filter((t) => t.page === i)}
                  controls={controls.filter((c) => c.page === i)}
                  fieldValues={fieldValues}
                  onChangeField={onChangeField}
                  sign={sign && sign.page === i ? sign : null}
                  editable={editable}
                  onAddText={addText}
                  onMoveText={moveText}
                  onResizeText={resizeText}
                  focusTextId={focusTextId}
                  onFocusedText={() => setFocusTextId(null)}
                  onChangeText={(id, value) =>
                    setTexts((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, text: value } : t)),
                    )
                  }
                  onRemoveText={(id) =>
                    setTexts((prev) => prev.filter((t) => t.id !== id))
                  }
                  onDrawSign={drawSign}
                  onRemoveSign={() => setSign(null)}
                />
              ))}
            </Document>
          )}
        </div>

        {/* Seitenpanel: Signatur + restliche Formularfelder */}
        {editable && (panelFields.length > 0 || sign) && (
          <aside className="max-h-[45vh] w-full shrink-0 overflow-auto border-t border-slate-200 bg-white p-3 text-sm md:max-h-none md:w-72 md:border-l md:border-t-0">
            {sign && (
              <div className="mb-4">
                <h3 className="mb-1 font-semibold">Signatur</h3>
                <p className="mb-2 text-xs text-slate-500">
                  Bereich auf Seite {sign.page + 1} aufgezogen.
                </p>
                <label className="label">Grund (optional)</label>
                <input
                  className="input mb-2"
                  value={sigReason}
                  onChange={(e) => setSigReason(e.target.value)}
                  placeholder="z. B. Freigabe"
                  maxLength={120}
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm text-red-600"
                  onClick={() => setSign(null)}
                >
                  Signatur entfernen
                </button>
              </div>
            )}
            {panelFields.length > 0 && (
              <div>
                <h3 className="mb-1 font-semibold">Formularfelder</h3>
                <div className="space-y-3">
                  {panelFields.map((f) => (
                    <FieldInput
                      key={f.name}
                      field={f}
                      value={fieldValues[f.name]}
                      onChange={(v) =>
                        setFieldValues((prev) => ({ ...prev, [f.name]: v }))
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldMeta;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={field.readOnly}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="truncate" title={field.name}>
          {field.name}
        </span>
      </label>
    );
  }
  if (
    (field.type === "dropdown" ||
      field.type === "radio" ||
      field.type === "optionlist") &&
    field.options?.length
  ) {
    return (
      <div>
        <label className="label truncate" title={field.name}>
          {field.name}
        </label>
        <select
          className="input"
          value={typeof value === "string" ? value : ""}
          disabled={field.readOnly}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— leer —</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "other") return null;
  const text = typeof value === "string" ? value : "";
  const maxLength = Math.min(field.maxLength ?? MAX_FIELD_TEXT, MAX_FIELD_TEXT);
  return (
    <div>
      <label className="label truncate" title={field.name}>
        {field.name}
      </label>
      {field.multiline ? (
        <textarea
          className="input min-h-20"
          value={text}
          disabled={field.readOnly}
          maxLength={maxLength}
          onChange={(e) => onChange(fieldText(e.target.value, field))}
        />
      ) : (
        <input
          className="input"
          value={text}
          disabled={field.readOnly}
          maxLength={maxLength}
          onChange={(e) => onChange(fieldText(e.target.value, field))}
        />
      )}
    </div>
  );
}

function PageLayer({
  pageIndex,
  width,
  tool,
  texts,
  textWidgets,
  controls,
  fieldValues,
  onChangeField,
  sign,
  editable,
  onAddText,
  onMoveText,
  onResizeText,
  focusTextId,
  onFocusedText,
  onChangeText,
  onRemoveText,
  onDrawSign,
  onRemoveSign,
}: {
  pageIndex: number;
  width: number;
  tool: Tool;
  texts: TextItem[];
  textWidgets: TextWidget[];
  controls: Control[];
  fieldValues: Record<string, string | boolean>;
  onChangeField: (name: string, value: string | boolean) => void;
  sign: SignItem | null;
  editable: boolean;
  onAddText: (page: number, x: number, y: number, sizeRatio: number) => void;
  onMoveText: (id: number, x: number, y: number) => void;
  onResizeText: (id: number, sizeRatio: number) => void;
  focusTextId: number | null;
  onFocusedText: () => void;
  onChangeText: (id: number, value: string) => void;
  onRemoveText: (id: number) => void;
  onDrawSign: (s: SignItem) => void;
  onRemoveSign: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  // Sichtbare Seitenhöhe in pt (pdf.js-Viewport bei Maßstab 1 = CropBox, rotiert).
  const [ptH, setPtH] = useState(0);
  // Während des Aufziehens der Signatur-Box:
  const [draw, setDraw] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Nie auf 0 zurückfallen (sonst rendern Overlays kurz an der 8px-Untergrenze).
    const ro = new ResizeObserver(() => {
      const ch = el.clientHeight;
      if (ch) setH(ch);
    });
    ro.observe(el);
    const ch0 = el.clientHeight;
    if (ch0) setH(ch0);
    return () => ro.disconnect();
  }, [width]);

  function ratio(e: { clientX: number; clientY: number }) {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
      rect,
    };
  }

  // Text setzen (Klick).
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || tool !== "text") return;
    const { x, y } = ratio(e);
    // Feste Größe in pt — früher 16 px, also je nach Zoom 5–25 pt.
    const pageH = ptH || 842;
    const sizeRatio = DEFAULT_TEXT_PT / pageH;
    // Klickpunkt = Mitte der ersten Zeile, nicht obere linke Ecke der Box.
    onAddText(pageIndex, x, Math.max(0, y - (sizeRatio * 1.5) / 2), sizeRatio);
  }

  // Signatur-Bereich aufziehen (Drag).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable || tool !== "sign") return;
    e.preventDefault();
    const { x, y } = ratio(e);
    setDraw({ x0: x, y0: y, x1: x, y1: y });
    // Auf der Wrap-Ebene capturen (nicht dem Klick-Kind), sonst kann der Capture
    // beim Canvas-Repaint verloren gehen.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draw) return;
    const { x, y } = ratio(e);
    setDraw((d) => (d ? { ...d, x1: x, y1: y } : d));
  }
  function onPointerUp() {
    if (!draw) return;
    const x = Math.min(draw.x0, draw.x1);
    const y = Math.min(draw.y0, draw.y1);
    let w = Math.abs(draw.x1 - draw.x0);
    let hh = Math.abs(draw.y1 - draw.y0);
    setDraw(null);
    // Zu kleiner Bereich (nur Klick) → sinnvolle Standardgröße.
    if (w < 0.04 || hh < 0.02) {
      w = 0.28;
      hh = 74 / Math.max(1, h);
    }
    onDrawSign({ page: pageIndex, xRatio: x, yRatio: y, wRatio: w, hRatio: hh });
  }

  const drawing = draw
    ? {
        left: Math.min(draw.x0, draw.x1) * 100,
        top: Math.min(draw.y0, draw.y1) * 100,
        width: Math.abs(draw.x1 - draw.x0) * 100,
        height: Math.abs(draw.y1 - draw.y0) * 100,
      }
    : null;

  return (
    <div className="mx-auto mb-4 w-fit shadow">
      <div
        ref={wrapRef}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative bg-white"
        style={{
          cursor: editable && tool !== "none" ? "crosshair" : "default",
          touchAction: tool === "sign" ? "none" : undefined,
        }}
      >
        <Page
          pageNumber={pageIndex + 1}
          width={width}
          onLoadSuccess={(p) => {
            // Höhe sofort aus dem Seitenverhältnis ableiten (vor dem Canvas-Paint)
            // → kein Springen der Overlays von der 8px-Untergrenze.
            const pg = p as unknown as { width: number; height: number; originalHeight: number };
            if (pg.width > 0) setH(Math.round(width * (pg.height / pg.width)));
            if (pg.originalHeight > 0) setPtH(pg.originalHeight);
          }}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          // Im Editor Formularfelder NICHT in die Canvas backen (sonst „Geister-
          // text" hinter den editierbaren Overlays). In der read-only-Ansicht
          // hingegen einbacken, damit Feldwerte sichtbar bleiben.
          renderForms={editable}
        />

        {/* Echte Formular-Textfelder — in-place editierbar; jedes Widget eines
            Feldes wird gezeigt (mehrere teilen denselben Wert, wie in Acrobat). */}
        {textWidgets.map((tw, idx) => {
          const r = tw.rect;
          const v = fieldValues[tw.name];
          // Schrift an die (oft sehr knappe) Feldhöhe anpassen: eine Textzeile
          // belegt ~1.15× der Schriftgröße. Passt die natürliche Größe nicht in
          // die Feldhöhe, wird sie gekappt, damit unten nichts abgeschnitten
          // wird — sonst nimmt sie die echte Größe. Kein fixer 8px-Boden (der
          // verschöbe das Verhältnis beim Rauszoomen). 1px schützt vor /0.
          const fontPx = Math.max(1, Math.min(tw.sizeRatio * h, (r.hRatio * h) / 1.15));
          // iOS hebt bei gesperrtem Zoom (maximum-scale=1) die Schriftgröße von
          // Formularfeldern auf min. 16px an → der Text quillt aus kleinen
          // Feldern nach unten. Lösung: das Feld logisch mit 16px rendern (iOS
          // greift dann nicht ein) und per transform exakt auf die Zielgröße
          // herunterskalieren. Nur nötig, wenn die Zielgröße < 16px liegt;
          // visuell identisch zu fontPx (auch auf Desktop).
          const k = fontPx < 16 ? fontPx / 16 : 1;
          return (
            <div
              key={`${tw.name}-${idx}`}
              className="absolute z-10 overflow-hidden rounded-sm bg-white/60 ring-1 ring-inset ring-emerald-400/70"
              style={{
                left: `${r.xRatio * 100}%`,
                top: `${r.yRatio * 100}%`,
                width: `${r.wRatio * 100}%`,
                height: `${r.hRatio * 100}%`,
              }}
              title={`Feld: ${tw.name}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <textarea
                value={typeof v === "string" ? v : ""}
                onChange={(e) => onChangeField(tw.name, fieldText(e.target.value, tw))}
                onKeyDown={(e) => {
                  // Einzeilige PDF-Felder können keinen Umbruch speichern.
                  if (e.key === "Enter" && !tw.multiline) e.preventDefault();
                }}
                maxLength={Math.min(tw.maxLength ?? MAX_FIELD_TEXT, MAX_FIELD_TEXT)}
                className="resize-none bg-transparent px-1 py-0 leading-none outline-none"
                style={
                  k < 1
                    ? {
                        fontSize: "16px",
                        width: `${100 / k}%`,
                        height: `${100 / k}%`,
                        transform: `scale(${k})`,
                        transformOrigin: "top left",
                      }
                    : { fontSize: `${fontPx}px`, width: "100%", height: "100%" }
                }
              />
            </div>
          );
        })}

        {/* Echte Formularfelder: Haken / Auswahl / Radio direkt im PDF */}
        {controls.map((c, idx) => {
          const pos = {
            left: `${c.rect.xRatio * 100}%`,
            top: `${c.rect.yRatio * 100}%`,
            width: `${c.rect.wRatio * 100}%`,
            height: `${c.rect.hRatio * 100}%`,
          };
          const stop = (e: React.SyntheticEvent) => e.stopPropagation();
          if (c.kind === "checkbox") {
            return (
              <input
                key={`cb-${c.name}-${idx}`}
                type="checkbox"
                checked={Boolean(fieldValues[c.name])}
                onChange={(e) => onChangeField(c.name, e.target.checked)}
                onClick={stop}
                onPointerDown={stop}
                title={`Feld: ${c.name}`}
                className="absolute z-10 m-0 cursor-pointer accent-brand-600"
                style={pos}
              />
            );
          }
          if (c.kind === "select") {
            const val =
              typeof fieldValues[c.name] === "string"
                ? (fieldValues[c.name] as string)
                : "";
            return (
              <select
                key={`sel-${c.name}-${idx}`}
                value={val}
                onChange={(e) => onChangeField(c.name, e.target.value)}
                onClick={stop}
                onPointerDown={stop}
                title={`Feld: ${c.name}`}
                className="absolute z-10 rounded-sm border border-emerald-400/70 bg-white/90 px-0.5 text-xs"
                style={pos}
              >
                <option value="">—</option>
                {c.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          }
          // radio
          return (
            <input
              key={`rd-${c.name}-${c.optionValue}-${idx}`}
              type="radio"
              name={`rg-${c.name}`}
              checked={fieldValues[c.name] === c.optionValue}
              onChange={() => onChangeField(c.name, c.optionValue)}
              onClick={stop}
              onPointerDown={stop}
              title={`${c.name}: ${c.optionValue}`}
              className="absolute z-10 m-0 cursor-pointer accent-brand-600"
              style={pos}
            />
          );
        })}

        {/* Live-Vorschau beim Aufziehen */}
        {drawing && (
          <div
            className="pointer-events-none absolute z-20 border-2 border-brand-500 bg-brand-50/40"
            style={{
              left: `${drawing.left}%`,
              top: `${drawing.top}%`,
              width: `${drawing.width}%`,
              height: `${drawing.height}%`,
            }}
          />
        )}

        {/* Freitext-Overlays: am Klickpunkt, verschiebbar (Griff), wachsen mit
            dem Inhalt mit; bleiben auch nach dem Speichern editierbar. */}
        {h > 0 &&
          texts.map((t) => (
            <FreeTextBox
              key={t.id}
              item={t}
              pageW={width}
              pageH={h}
              pagePt={ptH || 842}
              wrapRef={wrapRef}
              autoFocus={t.id === focusTextId}
              onFocused={onFocusedText}
              onChange={(v) => onChangeText(t.id, v)}
              onMove={(x, y) => onMoveText(t.id, x, y)}
              onResize={(r) => onResizeText(t.id, r)}
              onRemove={() => onRemoveText(t.id)}
            />
          ))}

        {/* Signatur-Bereich */}
        {sign && (
          <div
            className="absolute z-10 flex flex-col justify-center overflow-hidden rounded border-2 border-brand-500 bg-brand-50/70 px-1 text-[10px] text-brand-800"
            style={{
              left: `${sign.xRatio * 100}%`,
              top: `${sign.yRatio * 100}%`,
              width: `${sign.wRatio * 100}%`,
              height: `${sign.hRatio * 100}%`,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="font-semibold">✒ Signatur</span>
            <button
              type="button"
              onClick={onRemoveSign}
              className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-red-600 text-[10px] leading-4 text-white"
              title="Signatur entfernen"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Freitext-Box. Maße, Position und Zeilenlage folgen dem Layout, das pdf-lib
 * beim Speichern erzeugt (lib/pdf-edit.ts), damit der Text nach dem Speichern
 * nicht springt oder abgeschnitten wird.
 */
function FreeTextBox({
  item,
  pageW,
  pageH,
  pagePt,
  wrapRef,
  autoFocus,
  onFocused,
  onChange,
  onMove,
  onResize,
  onRemove,
}: {
  item: TextItem;
  pageW: number;
  pageH: number;
  pagePt: number;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (value: string) => void;
  onMove: (xRatio: number, yRatio: number) => void;
  onResize: (sizeRatio: number) => void;
  onRemove: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pt = pageH / pagePt; // px je pt beim aktuellen Zoom
  const fontPx = Math.max(1, item.sizeRatio * pageH);
  const sizePt = Math.round(item.sizeRatio * pagePt);
  const lines = item.text.split("\n");
  const multiline = lines.length > 1;
  const textW = Math.max(0, ...lines.map((l) => textWidthPx(l, fontPx)));
  const boxW = Math.min(pageW, Math.max(40 * pt, textW + 10 * pt));
  const boxH = Math.max(fontPx * 1.5, lines.length * fontPx * 1.32 + 6 * pt);
  // Wie serverseitig: die ganze Box bleibt auf der Seite.
  const left = Math.max(0, Math.min(item.xRatio, 1 - boxW / pageW));
  const top = Math.max(0, Math.min(item.yRatio, 1 - boxH / pageH));
  // Grundlinie wie pdf-lib: einzeilig vertikal zentriert, mehrzeilig ab oben.
  const baseline = multiline ? pt + PDF_LINE * fontPx : boxH / 2 + (PDF_CAP / 2) * fontPx;
  const padTop = Math.max(0, baseline - CSS_BASELINE * fontPx);
  // iOS vergrößert Eingaben unter 16 px → logisch mit 16 px rendern, skalieren.
  const k = fontPx < 16 ? fontPx / 16 : 1;

  useEffect(() => {
    if (!autoFocus) return;
    taRef.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  function startDrag(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const r0 = wrapRef.current?.getBoundingClientRect();
    if (!r0 || !r0.width || !r0.height) return;
    // Greifpunkt merken, damit die Box nicht unter den Zeiger springt.
    const offX = (e.clientX - r0.left) / r0.width - left;
    const offY = (e.clientY - r0.top) / r0.height - top;
    const maxX = Math.max(0, 1 - boxW / pageW);
    const maxY = Math.max(0, 1 - boxH / pageH);
    const move = (ev: PointerEvent) => {
      // Rechteck bei JEDEM Move neu lesen → korrekt auch beim Scrollen.
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      onMove(
        Math.min(maxX, Math.max(0, (ev.clientX - r.left) / r.width - offX)),
        Math.min(maxY, Math.max(0, (ev.clientY - r.top) / r.height - offY)),
      );
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  const setSize = (next: number) =>
    onResize(Math.min(MAX_TEXT_PT, Math.max(MIN_TEXT_PT, next)) / pagePt);
  // Buttons dürfen den Fokus nicht aus dem Textfeld nehmen.
  const keepFocus = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div
      className="group absolute z-10"
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: boxW, height: boxH }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        onPointerDown={startDrag}
        className="absolute -left-4 top-0 flex h-5 w-4 cursor-move select-none items-center justify-center rounded-l bg-brand-200 text-[10px] text-brand-700"
        style={{ touchAction: "none" }}
        title="Verschieben"
      >
        ⠿
      </span>
      <textarea
        ref={taRef}
        value={item.text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          // Leer gelassener neuer Text verschwindet wieder.
          if (!item.fieldName && !item.text.trim()) onRemove();
        }}
        maxLength={MAX_FREE_TEXT}
        // Kein weicher Umbruch: im PDF bricht nur ein echtes Enter um.
        wrap="off"
        placeholder="Text"
        className="block resize-none overflow-hidden whitespace-pre rounded-sm border border-brand-300 bg-white/70 outline-none placeholder:text-slate-400"
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: `${fontPx / k}px`,
          lineHeight: `${(PDF_LINE * fontPx) / k}px`,
          paddingTop: `${padTop / k}px`,
          paddingBottom: 0,
          paddingLeft: `${pt / k}px`,
          paddingRight: 0,
          width: `${boxW / k}px`,
          height: `${boxH / k}px`,
          transform: k < 1 ? `scale(${k})` : undefined,
          transformOrigin: "top left",
        }}
      />
      <div className="absolute -top-6 right-0 hidden items-center gap-0.5 rounded bg-white px-0.5 text-[10px] shadow ring-1 ring-slate-200 group-focus-within:flex">
        <button
          type="button"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => setSize(sizePt - 1)}
          className="px-1 text-slate-600 hover:text-slate-900"
          title="Schrift kleiner"
          aria-label="Schrift kleiner"
        >
          A−
        </button>
        <span className="tabular-nums text-slate-500">{sizePt} pt</span>
        <button
          type="button"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => setSize(sizePt + 1)}
          className="px-1 text-slate-600 hover:text-slate-900"
          title="Schrift größer"
          aria-label="Schrift größer"
        >
          A+
        </button>
      </div>
      <button
        type="button"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={onRemove}
        className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-red-600 text-[10px] leading-4 text-white"
        title="Text entfernen"
      >
        ×
      </button>
    </div>
  );
}
