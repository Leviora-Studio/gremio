// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { createContext, useContext, useState } from "react";
const DraftContext = createContext({ dirty: false, setDirty: (_dirty: boolean) => { } });
export function CashbookDraftProvider({ children }: {
    children: React.ReactNode;
}) { const [dirty, setDirty] = useState(false); return <DraftContext.Provider value={{ dirty, setDirty }}>{children}</DraftContext.Provider>; }
export function useCashbookDraft() { return useContext(DraftContext); }
