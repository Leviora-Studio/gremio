// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export function useRouter() { return { push: (url: string) => { window.location.hash = url; }, replace: (url: string) => { window.location.hash = url; }, refresh: () => {} }; }
