// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

/**
 * Textarea, das initial so hoch wie ein normales Eingabefeld ist und
 * automatisch mitwächst, sobald der Inhalt mehr Platz braucht.
 */
export function AutoTextarea({
  defaultValue,
  onChange,
  onBlur,
  placeholder,
  className,
}: {
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  // Beim ersten Render an den vorhandenen Inhalt anpassen.
  useEffect(resize, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={clsx(
        "input min-h-[2.5rem] resize-none overflow-hidden",
        className,
      )}
      onInput={resize}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
}
