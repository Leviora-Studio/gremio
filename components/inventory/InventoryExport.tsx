// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useState } from "react";
import { Select } from "@/components/Select";

/** Export der Inventarliste als CSV, mit wählbarer Sortierung. */
export function InventoryExport({ boardId }: { boardId: number }) {
  const [sort, setSort] = useState("name");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="w-full sm:w-72"
        value={sort}
        onChange={setSort}
        options={[
          { value: "name", label: "Sortierung: Bezeichnung" },
          { value: "number", label: "Sortierung: Inventarnummer" },
          { value: "category", label: "Sortierung: Kategorie" },
          { value: "location", label: "Sortierung: Standort" },
          { value: "price", label: "Sortierung: Preis (absteigend)" },
          { value: "purchase_date", label: "Sortierung: Kaufdatum" },
          { value: "condition", label: "Sortierung: Zustand" },
        ]}
      />
      <a
        href={`/api/inventory/board/${boardId}/export?sort=${sort}`}
        className="btn-secondary shrink-0"
      >
        Export (CSV)
      </a>
    </div>
  );
}
