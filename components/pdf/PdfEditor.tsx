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
};

export type PdfEditorProps = {
  src: string;
  filename: string;
  attachmentId: number;
  editable: boolean;
  hasCert: boolean;
  onClose: () => void;
};

let nextId = 1;

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

  const [mode, setMode] = useState<"new" | "replace">("new");
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
        const init: Record<string, string | boolean> = {};
        for (const f of fs) {
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

  const onPageClick = useCallback(
    (page: number, xRatio: number, yRatio: number, pageHeightPx: number) => {
      if (!editable) return;
      if (tool === "text") {
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
      } else if (tool === "sign") {
        const hRatio = 74 / Math.max(1, pageHeightPx);
        setSign({ page, xRatio, yRatio, wRatio: 0.3, hRatio });
        setTool("none");
      }
    },
    [editable, tool],
  );

  function changedFields() {
    const out: { name: string; value: string | boolean }[] = [];
    for (const f of fields) {
      if (f.readOnly) continue;
      const v = fieldValues[f.name];
      const orig = f.type === "checkbox" ? Boolean(f.value) : (f.value ?? "");
      if (v !== orig) out.push({ name: f.name, value: v });
    }
    return out;
  }

  async function handleSave() {
    setError(null);
    const fieldEdits = changedFields();
    const wantsSign = !!sign;
    if (!texts.length && !fieldEdits.length && !wantsSign) {
      setError("Keine Änderungen zum Speichern.");
      return;
    }
    if (wantsSign && !hasCert) {
      setError(
        "Kein Signatur-Zertifikat hinterlegt — bitte zuerst in den Konto-Einstellungen hinzufügen.",
      );
      return;
    }
    const payload: SavePdfInput = {
      attachmentId,
      mode,
      edits: {
        texts: texts.map((t) => ({
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

  const dirty = texts.length > 0 || !!sign || changedFields().length > 0;

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
                  ? "Signatur platzieren"
                  : "Kein Zertifikat hinterlegt (Konto-Einstellungen)"
              }
            >
              ✒ Signieren
            </button>
            {tool !== "none" && (
              <span className="text-xs text-brand-700">
                {tool === "text"
                  ? "Auf die Seite klicken, um Text zu setzen"
                  : "Auf die Seite klicken, um die Signatur zu platzieren"}
              </span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {editable && (
            <>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "new" | "replace")}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-sm"
              >
                <option value="new">Als neue Datei speichern</option>
                <option value="replace">Original ersetzen</option>
              </select>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={saving || !dirty}
                onClick={handleSave}
              >
                {saving ? "Speichert…" : "Speichern"}
              </button>
            </>
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
                  cursorTool={tool}
                  texts={texts.filter((t) => t.page === i)}
                  sign={sign && sign.page === i ? sign : null}
                  editable={editable}
                  onClick={onPageClick}
                  onChangeText={(id, value) =>
                    setTexts((prev) =>
                      prev.map((t) => (t.id === id ? { ...t, text: value } : t)),
                    )
                  }
                  onRemoveText={(id) =>
                    setTexts((prev) => prev.filter((t) => t.id !== id))
                  }
                  onRemoveSign={() => setSign(null)}
                />
              ))}
            </Document>
          )}
        </div>

        {/* Seitenpanel: Formularfelder + Signatur */}
        {editable && (fields.length > 0 || sign) && (
          <aside className="w-72 shrink-0 overflow-auto border-l border-slate-200 bg-white p-3 text-sm">
            {sign && (
              <div className="mb-4">
                <h3 className="mb-1 font-semibold">Signatur</h3>
                <p className="mb-2 text-xs text-slate-500">
                  Platziert auf Seite {sign.page + 1}.
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
            {fields.length > 0 && (
              <div>
                <h3 className="mb-1 font-semibold">Formularfelder</h3>
                <div className="space-y-3">
                  {fields.map((f) => (
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
  cursorTool,
  texts,
  sign,
  editable,
  onClick,
  onChangeText,
  onRemoveText,
  onRemoveSign,
}: {
  pageIndex: number;
  width: number;
  cursorTool: Tool;
  texts: TextItem[];
  sign: SignItem | null;
  editable: boolean;
  onClick: (page: number, xRatio: number, yRatio: number, hPx: number) => void;
  onChangeText: (id: number, value: string) => void;
  onRemoveText: (id: number) => void;
  onRemoveSign: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [width]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editable || cursorTool === "none") return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    onClick(pageIndex, xRatio, yRatio, rect.height);
  }

  return (
    <div className="mx-auto mb-4 w-fit shadow">
      <div
        ref={wrapRef}
        onClick={handleClick}
        className="relative bg-white"
        style={{ cursor: editable && cursorTool !== "none" ? "crosshair" : "default" }}
      >
        <Page
          pageNumber={pageIndex + 1}
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
        {/* Freitext-Overlays */}
        {texts.map((t) => (
          <div
            key={t.id}
            className="absolute z-10 -translate-y-1 rounded border border-brand-300 bg-white/70"
            style={{ left: `${t.xRatio * 100}%`, top: `${t.yRatio * 100}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              value={t.text}
              onChange={(e) => onChangeText(t.id, e.target.value)}
              rows={1}
              className="resize-none bg-transparent px-1 leading-tight outline-none"
              style={{ fontSize: `${Math.max(8, t.sizeRatio * h)}px`, minWidth: 60 }}
            />
            <button
              type="button"
              onClick={() => onRemoveText(t.id)}
              className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-red-600 text-[10px] leading-4 text-white"
              title="Text entfernen"
            >
              ×
            </button>
          </div>
        ))}
        {/* Signatur-Overlay */}
        {sign && (
          <div
            className="absolute z-10 flex flex-col justify-center rounded border-2 border-brand-500 bg-brand-50/70 px-1 text-[10px] text-brand-800"
            style={{
              left: `${sign.xRatio * 100}%`,
              top: `${sign.yRatio * 100}%`,
              width: `${sign.wRatio * 100}%`,
              height: `${sign.hRatio * 100}%`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-semibold">✒ Signatur hier</span>
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
