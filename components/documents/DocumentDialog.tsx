// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/Modal";

export function DocumentDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <Modal portal manageFocus keepMounted open={open} onClose={onClose} title="Sitzungsdaten"><div className="space-y-3">{children}</div></Modal>;
}
