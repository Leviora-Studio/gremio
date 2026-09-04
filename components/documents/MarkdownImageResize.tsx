// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type Box = { left: number; top: number; width: number; height: number };
type ImageTarget = { image: HTMLImageElement; start: number; end: number; source: string };

/** Resize handles live outside contentEditable; dragging commits one source transaction. */
export function MarkdownImageResize({ root, locate, onResize }: { root: RefObject<HTMLDivElement | null>; locate: (image: HTMLImageElement) => ImageTarget | null; onResize: (target: ImageTarget, width: number) => void }) {
  const [box, setBox] = useState<Box>();
  const target = useRef<ImageTarget | null>(null);
  const drag = useRef<{ x: number; y: number; width: number; height: number; dx: number; dy: number; current: number; originalStyle: string } | null>(null);
  const latest = useRef({ locate, onResize }); latest.current = { locate, onResize };
  const measure = useCallback(() => {
    if (!target.current || !root.current) return;
    const image = target.current.image.getBoundingClientRect(); const bounds = root.current.getBoundingClientRect();
    setBox({ left: image.left - bounds.left - root.current.clientLeft, top: image.top - bounds.top - root.current.clientTop, width: image.width, height: image.height });
  }, [root]);
  const cancel = useCallback(() => {
    if (drag.current && target.current) target.current.image.style.width = drag.current.originalStyle;
    drag.current = null; target.current = null; setBox(undefined);
  }, []);
  useEffect(() => {
    const node = root.current;
    const hover = (event: PointerEvent) => {
      if (drag.current) return;
      const image = (event.target as Element).closest<HTMLImageElement>('img[data-md-token="image"]');
      if (image && node?.contains(image)) { target.current = latest.current.locate(image); measure(); }
    };
    const leave = () => { if (!drag.current) { target.current = null; setBox(undefined); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    node?.addEventListener("pointerover", hover); node?.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", leave, true); window.addEventListener("resize", leave); window.addEventListener("keydown", escape);
    return () => {
      if (drag.current && target.current) target.current.image.style.width = drag.current.originalStyle;
      node?.removeEventListener("pointerover", hover); node?.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", leave, true); window.removeEventListener("resize", leave); window.removeEventListener("keydown", escape);
    };
  }, [root, measure, cancel]);
  if (!box) return null;
  return <div data-image-resize className="pointer-events-none absolute z-10 !m-0 border border-brand-500" style={box}>
    {([[-1, -1, "oben links"], [1, -1, "oben rechts"], [-1, 1, "unten links"], [1, 1, "unten rechts"]] as const).map(([dx, dy, label]) => <button key={label} type="button" aria-label={`Bild skalieren: ${label}`} title="Ziehen zum Skalieren · Pfeiltasten für Feinanpassung" className={`pointer-events-auto absolute h-3 w-3 touch-none rounded-sm border border-brand-600 bg-white ${dx === dy ? "cursor-nwse-resize" : "cursor-nesw-resize"}`} style={{ [dx < 0 ? "left" : "right"]: -6, [dy < 0 ? "top" : "bottom"]: -6 }}
      onPointerDown={event => {
        if (!target.current) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height, dx, dy, current: box.width, originalStyle: target.current.image.style.width };
      }}
      onPointerMove={event => {
        const active = drag.current; if (!active || !target.current) return;
        const horizontal = (event.clientX - active.x) * active.dx;
        const vertical = (event.clientY - active.y) * active.dy * active.width / Math.max(1, active.height);
        const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
        active.current = Math.max(48, Math.min(1600, target.current.image.parentElement!.clientWidth, Math.round(active.width + delta)));
        target.current.image.style.width = `${active.current}px`; measure();
      }}
      onPointerUp={event => {
        const active = drag.current; const current = target.current;
        if (!active || !current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        current.image.style.width = active.originalStyle; drag.current = null; target.current = null; setBox(undefined);
        if (Math.abs(active.current - active.width) >= 1) latest.current.onResize(current, active.current);
      }}
      onPointerCancel={cancel}
      onKeyDown={event => {
        if (!target.current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault(); const current = target.current; const width = box.width + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -10 : 10);
        target.current = null; setBox(undefined); latest.current.onResize(current, width);
      }}
    />)}
  </div>;
}
