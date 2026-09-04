// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export type TextareaDropCaret = { offset: number; left: number; top: number; height: number };

/** Measure the browser's actual text layout, including wrapping, tabs and scrolling. */
export function textareaDropCaret(textarea: HTMLTextAreaElement, x: number, y: number): TextareaDropCaret | null {
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  if (!view) return null;
  const bounds = textarea.getBoundingClientRect();
  const style = view.getComputedStyle(textarea);
  const mirror = doc.createElement("div");
  for (const property of [
    "font-family", "font-size", "font-weight", "font-style", "font-variant",
    "line-height", "letter-spacing", "word-spacing", "text-transform", "text-indent",
    "text-align", "direction", "tab-size", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "word-break", "overflow-wrap",
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", left: `${bounds.left + textarea.clientLeft}px`,
    top: `${bounds.top + textarea.clientTop}px`, width: `${textarea.clientWidth}px`,
    height: `${textarea.clientHeight}px`, boxSizing: "border-box", margin: "0",
    whiteSpace: textarea.wrap === "off" ? "pre" : "pre-wrap", overflow: "hidden",
    opacity: "0", pointerEvents: "auto", zIndex: "2147483647",
  });
  mirror.setAttribute("aria-hidden", "true");
  // A final zero-width character gives empty documents/trailing newlines a caret box.
  const text = doc.createTextNode(`${textarea.value}\u200b`);
  mirror.append(text);
  doc.body.append(mirror);
  try {
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
    const rect = mirror.getBoundingClientRect();
    const pointX = Math.max(rect.left + 1, Math.min(x, rect.right - 1));
    const pointY = Math.max(rect.top + 1, Math.min(y, rect.bottom - 1));
    const caretDocument = doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = caretDocument.caretPositionFromPoint?.(pointX, pointY);
    const fallback = position ? null : caretDocument.caretRangeFromPoint?.(pointX, pointY);
    const node = position?.offsetNode ?? fallback?.startContainer;
    if (node !== text) return null;
    const offset = Math.min(textarea.value.length, position?.offset ?? fallback?.startOffset ?? 0);
    const range = doc.createRange();
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const caret = range.getClientRects()[0];
    if (!caret) return null;
    return { offset, left: caret.left - bounds.left, top: caret.top - bounds.top, height: caret.height };
  } finally {
    mirror.remove();
  }
}
