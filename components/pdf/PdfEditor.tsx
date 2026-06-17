// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

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
};

export type PdfEditorProps = {
  src: string;
  filename: string;
  attachmentId: number;
  editable: boolean;
  hasCert: boolean;
  onClose: () => void;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
let nextId = 1;

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
}: PdfEditorProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const initialTextsRef = useRef<string>("[]");
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
    fetch(`/api/attachment/${attachmentId}/fields`)
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((d: { fields?: FieldMeta[] }) => {
        if (!active) return;
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
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [attachmentId, editable]);

  const addText = useCallback(
    (page: number, xRatio: number, yRatio: number, pageHeightPx: number) => {
      setTexts((prev) => [
        ...prev,
        {
          id: nextId++,
          page,
          xRatio,
          yRatio,
          text: "Text",
          sizeRatio: 16 / Math.max(1, pageHeightPx),
        },
      ]);
      setTool("none");
    },
    [],
  );

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

  const textsJson = JSON.stringify(texts.map(normText));
  const dirty =
    textsJson !== initialTextsRef.current ||
    !!sign ||
    changedFields().length > 0;

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
      edits: {
        texts: texts.map((t) => ({
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
      const res = await savePdfEditsAction(payload);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Speichern fehlgeschlagen (Netzwerk?).");
    } finally {
      setSaving(false);
    }
  }

  // Echte (nicht von uns angelegte) Formular-Textfelder bleiben an fester
  // Position editierbar; unsere Freitexte laufen über `texts`. Rest → Panel.
  const positionedFields = editable
    ? fields.filter(
        (f) =>
          f.type === "text" &&
          !f.gremioText &&
          !f.readOnly &&
          f.rect &&
          f.page != null,
      )
    : [];
  const positionedNames = new Set(positionedFields.map((f) => f.name));
  const panelFields = fields.filter(
    (f) => !f.gremioText && !positionedNames.has(f.name),
  );

  const onChangeField = (name: string, value: string | boolean) =>
    setFieldValues((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span className="mr-2 max-w-[16rem] truncate font-medium" title={filename}>
          {filename}
        </span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
        >
          −
        </button>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
        >
          +
        </button>

        {editable && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <button
              type="button"
              className={tool === "text" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              onClick={() => setTool((t) => (t === "text" ? "none" : "text"))}
            >
              ✎ Text
            </button>
            <button
              type="button"
              className={tool === "sign" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
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
              <span className="text-xs text-brand-700">
                {tool === "text"
                  ? "Auf die Seite klicken, um Text zu setzen (danach verschiebbar)"
                  : "Auf der Seite einen Bereich aufziehen"}
              </span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
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
              title="Speichert die Änderungen ins Original"
            >
              {saving ? "Speichert…" : "Speichern"}
            </button>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
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
              file={src}
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
                  fields={positionedFields.filter((f) => f.page === i)}
                  fieldValues={fieldValues}
                  onChangeField={onChangeField}
                  sign={sign && sign.page === i ? sign : null}
                  editable={editable}
                  onAddText={addText}
                  onMoveText={moveText}
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
          <aside className="w-72 shrink-0 overflow-auto border-l border-slate-200 bg-white p-3 text-sm">
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
  return (
    <div>
      <label className="label truncate" title={field.name}>
        {field.name}
      </label>
      <input
        className="input"
        value={typeof value === "string" ? value : ""}
        disabled={field.readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function PageLayer({
  pageIndex,
  width,
  tool,
  texts,
  fields,
  fieldValues,
  onChangeField,
  sign,
  editable,
  onAddText,
  onMoveText,
  onChangeText,
  onRemoveText,
  onDrawSign,
  onRemoveSign,
}: {
  pageIndex: number;
  width: number;
  tool: Tool;
  texts: TextItem[];
  fields: FieldMeta[];
  fieldValues: Record<string, string | boolean>;
  onChangeField: (name: string, value: string | boolean) => void;
  sign: SignItem | null;
  editable: boolean;
  onAddText: (page: number, x: number, y: number, hPx: number) => void;
  onMoveText: (id: number, x: number, y: number) => void;
  onChangeText: (id: number, value: string) => void;
  onRemoveText: (id: number) => void;
  onDrawSign: (s: SignItem) => void;
  onRemoveSign: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
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
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
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
    const { x, y, rect } = ratio(e);
    onAddText(pageIndex, x, y, rect.height);
  }

  // Signatur-Bereich aufziehen (Drag).
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable || tool !== "sign") return;
    e.preventDefault();
    const { x, y } = ratio(e);
    setDraw({ x0: x, y0: y, x1: x, y1: y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
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

  // Text-Box verschieben (Grip ziehen).
  function startTextDrag(e: React.PointerEvent, id: number) {
    e.stopPropagation();
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      onMoveText(
        id,
        clamp01((ev.clientX - rect.left) / rect.width),
        clamp01((ev.clientY - rect.top) / rect.height),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
          renderTextLayer={false}
          renderAnnotationLayer={false}
          // Im Editor Formularfelder NICHT in die Canvas backen (sonst „Geister-
          // text" hinter den editierbaren Overlays). In der read-only-Ansicht
          // hingegen einbacken, damit Feldwerte sichtbar bleiben.
          renderForms={editable}
        />

        {/* Vorhandene Textfelder (auch zuvor gespeicherter Freitext) — in-place
            editierbar; Position/Größe aus dem PDF. */}
        {fields.map((f) => {
          const r = f.rect!;
          const v = fieldValues[f.name];
          const fontPx = Math.max(8, (f.sizeRatio ?? 0.02) * h);
          return (
            <div
              key={f.name}
              className="absolute z-10 rounded-sm border border-emerald-400/70 bg-white/60"
              style={{
                left: `${r.xRatio * 100}%`,
                top: `${r.yRatio * 100}%`,
                width: `${r.wRatio * 100}%`,
                height: `${r.hRatio * 100}%`,
              }}
              title={`Feld: ${f.name}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <textarea
                value={typeof v === "string" ? v : ""}
                onChange={(e) => onChangeField(f.name, e.target.value)}
                className="h-full w-full resize-none bg-transparent px-1 leading-tight outline-none"
                style={{ fontSize: `${fontPx}px` }}
              />
            </div>
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
        {texts.map((t) => {
          const fontPx = Math.max(8, t.sizeRatio * h);
          const lines = (t.text || "").split("\n");
          const maxLen = Math.max(1, ...lines.map((l) => l.length));
          const boxW = Math.max(40, maxLen * fontPx * 0.55 + 10);
          const boxH = Math.max(fontPx * 1.5, lines.length * fontPx * 1.32 + 6);
          return (
            <div
              key={t.id}
              className="absolute z-10"
              style={{ left: `${t.xRatio * 100}%`, top: `${t.yRatio * 100}%` }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span
                onPointerDown={(e) => startTextDrag(e, t.id)}
                className="absolute -left-3 top-0 flex h-4 w-3 cursor-move select-none items-center justify-center rounded-l bg-brand-200 text-[9px] text-brand-700"
                title="Verschieben"
              >
                ⠿
              </span>
              <textarea
                value={t.text}
                onChange={(e) => onChangeText(t.id, e.target.value)}
                className="block resize-none overflow-hidden rounded-sm border border-brand-300 bg-white/70 px-1 leading-tight outline-none"
                style={{
                  width: boxW,
                  height: boxH,
                  fontSize: fontPx,
                  fontFamily: "Helvetica, Arial, sans-serif",
                }}
              />
              {!t.fieldName && (
                <button
                  type="button"
                  onClick={() => onRemoveText(t.id)}
                  className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-red-600 text-[10px] leading-4 text-white"
                  title="Text entfernen"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

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
