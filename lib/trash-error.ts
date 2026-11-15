// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export class TrashError extends Error {
  constructor(message: string) { super(message); this.name = "TrashError"; }
}
