// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Auffälliger roter Kasten ganz oben auf der Statusseite: Der Status-Link ist
 * das EINZIGE, womit der Antragsteller seinen Antrag wiederfindet — er wird
 * nicht per Mail verschickt. Deshalb steht er vor allem anderen, der Link ist
 * größer gesetzt als der Hinweistext und direkt kopierbar.
 */
export function StatusLinkBox({
  link,
  pdfHref,
  subject = "deinen Antrag",
}: {
  link: string;
  /** Optionaler Button oben rechts (z. B. Eingangsbestätigung als PDF). */
  pdfHref?: string;
  /** Wovon der Link der einzige Zugang ist — im Akkusativ, z. B. „deine Anfrage". */
  subject?: string;
}) {
  // idle → copied (Haken) bzw. failed (Hinweis „bitte manuell markieren").
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copied = status === "copied";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Fallback ohne Clipboard-API: unsichtbares Textfeld + execCommand. */
  function copyViaTextarea(): boolean {
    try {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, link.length); // iOS braucht den expliziten Bereich
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function copy() {
    // navigator.clipboard EXISTIERT auch dort, wo es abgewiesen wird (fehlende
    // Berechtigung, unsicherer Kontext, iframe ohne clipboard-write) — die
    // Existenzprüfung allein reicht deshalb nicht. Bei jedem Fehlschlag wird
    // auf execCommand zurückgefallen.
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = copyViaTextarea();

    // Blockiert der Browser das Kopieren (Berechtigung/Kontext), KEINE falsche
    // Erfolgsmeldung zeigen, sondern auf manuelles Markieren hinweisen.
    setStatus(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), ok ? 2000 : 4000);
  }

  return (
    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 sm:p-5">
      {/* flex-wrap + min-w: Reicht der Platz nicht, rutscht der PDF-Button unter
          den Link, statt ihn auf drei Zeilen zu quetschen. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-[18rem] flex-1">
          <p className="text-sm font-medium text-red-700">
            Bitte speichere diesen Link:
          </p>
          <div className="mt-1.5 flex items-start gap-2">
            <a
              href={link}
              className="min-w-0 break-all text-lg font-semibold leading-snug text-red-900 underline decoration-red-300 underline-offset-2 hover:decoration-red-600 sm:text-xl"
            >
              {link}
            </a>
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Link kopiert" : "Link kopieren"}
              title={copied ? "Kopiert!" : "Link kopieren"}
              className="mt-0.5 shrink-0 rounded-md border border-red-300 bg-white p-1.5 text-red-700 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          {/* Erfolg signalisiert sichtbar der grüne Haken im Button; hier nur
              fürs Screenreader-Publikum (sr-only → reserviert keine Leerzeile).
              Ein Fehlschlag braucht dagegen sichtbaren Text. */}
          <p aria-live="polite" className="sr-only">
            {status === "copied" ? "Link kopiert." : ""}
          </p>
          {status === "failed" && (
            <p className="mt-1.5 text-sm font-medium text-red-800">
              Dein Browser erlaubt kein automatisches Kopieren — bitte markiere
              den Link von Hand.
            </p>
          )}
          <p className="mt-1.5 text-sm text-red-800">
            Ohne diesen Link kommst du nicht mehr an {subject} — er wird nicht
            per E-Mail verschickt.
          </p>
        </div>

        {pdfHref && (
          <a href={pdfHref} className="btn-primary shrink-0 whitespace-nowrap">
            Eingangsbestätigung (PDF)
          </a>
        )}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-green-700"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
