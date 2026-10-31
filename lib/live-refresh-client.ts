// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
let coordinator:(()=>void)|undefined;
export function registerRefreshCoordinator(callback:()=>void){coordinator=callback;return()=>{if(coordinator===callback)coordinator=undefined;};}
export function requestLiveRefresh(fallback:()=>void){if(coordinator)coordinator();else fallback();}
