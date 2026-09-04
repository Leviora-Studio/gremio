// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

export async function saveTaskPrefsAction(value: unknown) {
  (window as typeof window & { savedHomePrefs: unknown[] }).savedHomePrefs.push(value);
}
