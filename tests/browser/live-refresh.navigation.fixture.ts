// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const router = { refresh: () => window.dispatchEvent(new Event('fixture-refresh')) };
export const useRouter = () => router;
export const usePathname = () => '/intern/test';
