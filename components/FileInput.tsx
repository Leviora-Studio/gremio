// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useId, useRef, useState } from "react";
import { clsx } from "clsx";

export function FileInput({
  name,
  accept,
  required,
  className,
  label = "Datei auswählen",
  disabled,
  onSelect,
  hideStatus,
  triggerClassName,
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  className?: string;
  label?: string;
  disabled?: boolean;
  onSelect?: () => void;
  hideStatus?: boolean;
  triggerClassName?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const [fileName, setFileName] = useState("");

  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={triggerClassName ?? "btn-secondary btn-sm shrink-0"}
      >
        {fileName ? "Andere Datei" : label}
      </button>
      {hideStatus ? null : fileName ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1 text-sm font-medium text-green-700 ring-1 ring-green-200">
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            className="shrink-0"
            aria-hidden
          >
            <path
              d="M4 10.5 8 14.5 16 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate">{fileName}</span>
        </span>
      ) : (
        <span className="text-sm text-slate-400">Keine Datei ausgewählt</span>
      )}
      <input
        ref={ref}
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setFileName(file?.name ?? "");
          if (file) onSelect?.();
        }}
      />
    </div>
  );
}
