"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Keep completed/in-flight upload feedback mounted when SSE revokes a gate. */
export function PublicGate({ allowed, children, className = "" }: { allowed: boolean; children: ReactNode; className?: string }) {
  const [seen, setSeen] = useState(allowed);
  useEffect(() => { if (allowed) setSeen(true); }, [allowed]);
  if (!seen && !allowed) return null;
  return <fieldset disabled={!allowed} className={`min-w-0 ${className}`}>
    {!allowed && <p className="text-sm text-amber-700">Dieser Bereich ist inzwischen gesperrt. Bereits angezeigte Upload-Ergebnisse bleiben zur Kontrolle sichtbar.</p>}
    {children}
  </fieldset>;
}
