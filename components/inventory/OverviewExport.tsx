// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { useState } from "react";
import { Select } from "@/components/Select";

/** CSV-Export des Anlagenverzeichnisses mit wählbarer Sortierung. */
export function OverviewExport() {
  const [sort, setSort] = useState("board");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="w-full sm:w-72"
        value={sort}
        onChange={setSort}
        options={[
          { value: "board", label: "Sortierung: Inventar" },
          { value: "name", label: "Sortierung: Bezeichnung" },
          { value: "number", label: "Sortierung: Inventarnummer" },
          { value: "condition", label: "Sortierung: Zustand" },
          { value: "purchase_date", label: "Sortierung: Kaufdatum" },
          { value: "vendor", label: "Sortierung: Händler" },
          { value: "price", label: "Sortierung: Einzelpreis (absteigend)" },
        ]}
      />
      <a
        href={`/api/inventory/overview/export?sort=${sort}`}
        className="btn-secondary shrink-0"
      >
        Export (CSV)
      </a>
    </div>
  );
}
