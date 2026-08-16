// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resyncProfileAction } from "@/app/intern/konto/actions";

export function ResyncProfileButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await resyncProfileAction();
            if (r.ok) {
              setMsg({ ok: true, text: "Profil aus dem SSO aktualisiert." });
              router.refresh();
            } else {
              setMsg({ ok: false, text: r.error ?? "Fehler." });
            }
          })
        }
      >
        {pending ? "Aktualisiere …" : "Profil aus SSO aktualisieren"}
      </button>
      {msg && (
        <span
          className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
