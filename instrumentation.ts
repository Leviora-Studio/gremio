// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

export async function register() {
  // Nur im Node-Runtime und in Produktion automatisch migrieren/seeden.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production"
  ) {
    const { runStartupBootstrap } = await import("./lib/bootstrap");
    await runStartupBootstrap();
  }
}
